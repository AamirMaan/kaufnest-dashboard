-- supabase/migrations/047_advanced_inventory.sql
-- ============================================================
-- Advanced inventory (Business plan): batches, locations, FIFO cost of
-- goods and stock transfers. Design:
-- docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md
--
-- This file ONLY defines public.install_advanced_inventory(schema_name),
-- an idempotent installer that creates every table, policy, function and
-- trigger of the feature inside ONE tenant schema. It touches no tenant by
-- itself. Two callers (the "2 places" rule, via one shared installer
-- instead of duplicating this SQL into 005):
--   * 048_advanced_inventory_apply.sql — every existing tenant_% schema
--   * provision_tenant_schema() (005)  — every new tenant
--
-- Everything is inert until inventory_settings.advanced_enabled = true
-- (flipped by enable_advanced_inventory(), called from
-- POST /api/inventory/enable-advanced). The legacy current_stock triggers
-- (apply_purchase_stock_change / apply_sale_stock_change) are untouched and
-- keep running for every plan.
--
-- RULE for editing: inside format($sql$ … $sql$, schema_name) strings never
-- write a literal percent sign — format() consumes it. Build messages with ||.
-- ============================================================

CREATE OR REPLACE FUNCTION public.install_advanced_inventory(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $inst$
DECLARE
  fn record;
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;

  -- ── 1. Tables and columns ─────────────────────────────────
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.stock_locations (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL CHECK (length(btrim(name)) > 0),
      type       text NOT NULL CHECK (type IN ('own', 'fba', '3pl', 'dropship')),
      is_active  boolean NOT NULL DEFAULT true,
      created_by uuid REFERENCES %1$I.profiles(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_name_key
      ON %1$I.stock_locations (lower(name));

    CREATE TABLE IF NOT EXISTS %1$I.inventory_settings (
      id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
      advanced_enabled    boolean NOT NULL DEFAULT false,
      enabled_at          timestamptz,
      default_location_id uuid REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT
    );
    INSERT INTO %1$I.inventory_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS %1$I.platform_location_defaults (
      platform    text PRIMARY KEY
                    CHECK (platform IN ('amazon', 'ebay', 'etsy', 'shopify', 'other')),
      location_id uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT
    );

    ALTER TABLE %1$I.purchases
      ADD COLUMN IF NOT EXISTS location_id  uuid REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS freight_cost numeric(12,2) CHECK (freight_cost >= 0),
      ADD COLUMN IF NOT EXISTS customs_cost numeric(12,2) CHECK (customs_cost >= 0),
      ADD COLUMN IF NOT EXISTS other_cost   numeric(12,2) CHECK (other_cost >= 0);

    ALTER TABLE %1$I.sales
      ADD COLUMN IF NOT EXISTS fulfillment_location_id uuid REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS cogs_amount numeric(12,2);

    CREATE TABLE IF NOT EXISTS %1$I.stock_lots (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id    uuid NOT NULL REFERENCES %1$I.products(id) ON DELETE CASCADE,
      location_id   uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      purchase_id   uuid REFERENCES %1$I.purchases(id),
      source_lot_id uuid REFERENCES %1$I.stock_lots(id) ON DELETE CASCADE,
      kind          text NOT NULL CHECK (kind IN ('purchase', 'opening', 'transfer', 'shortfall')),
      received_at   timestamptz NOT NULL,
      cost_addon    numeric(14,4) NOT NULL DEFAULT 0,
      unit_cost     numeric(14,4) NOT NULL,
      qty_received  integer NOT NULL,
      qty_remaining integer NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (kind = 'shortfall' OR qty_remaining >= 0),
      CHECK (kind <> 'shortfall' OR qty_remaining <= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_lots_fifo
      ON %1$I.stock_lots (product_id, location_id, received_at, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS stock_lots_one_shortfall
      ON %1$I.stock_lots (product_id, location_id) WHERE kind = 'shortfall';
    CREATE INDEX IF NOT EXISTS idx_stock_lots_purchase ON %1$I.stock_lots (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_stock_lots_source ON %1$I.stock_lots (source_lot_id);

    CREATE TABLE IF NOT EXISTS %1$I.stock_transfers (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id       uuid NOT NULL REFERENCES %1$I.products(id) ON DELETE CASCADE,
      from_location_id uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      to_location_id   uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      quantity         integer NOT NULL CHECK (quantity > 0),
      transfer_cost    numeric(12,2) CHECK (transfer_cost >= 0),
      date             date NOT NULL,
      note             text,
      created_by       uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at       timestamptz NOT NULL DEFAULT now(),
      CHECK (from_location_id <> to_location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_date ON %1$I.stock_transfers (date DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS %1$I.stock_movements (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id  uuid NOT NULL REFERENCES %1$I.products(id) ON DELETE CASCADE,
      location_id uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      lot_id      uuid NOT NULL REFERENCES %1$I.stock_lots(id) ON DELETE CASCADE,
      kind        text NOT NULL
                    CHECK (kind IN ('receipt', 'opening', 'sale', 'transfer_out', 'transfer_in')),
      qty         integer NOT NULL,
      unit_cost   numeric(14,4) NOT NULL,
      sale_id     uuid REFERENCES %1$I.sales(id) ON DELETE CASCADE,
      purchase_id uuid REFERENCES %1$I.purchases(id) ON DELETE CASCADE,
      transfer_id uuid REFERENCES %1$I.stock_transfers(id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((kind = 'sale') = (sale_id IS NOT NULL)),
      CHECK ((kind = 'receipt') = (purchase_id IS NOT NULL)),
      CHECK ((kind IN ('transfer_out', 'transfer_in')) = (transfer_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_lot ON %1$I.stock_movements (lot_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_sale ON %1$I.stock_movements (sale_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_transfer ON %1$I.stock_movements (transfer_id);
  $sql$, schema_name);

  -- ── 2. RLS and privileges ─────────────────────────────────
  -- Ledger tables (settings, lots, movements) are SELECT-only for clients:
  -- only SECURITY DEFINER triggers/RPCs write them. Locations and platform
  -- defaults are admin-only writes; transfers are any tenant member (same
  -- bar as purchases). The REVOKEs must run after table creation so they
  -- override the schema's ALTER DEFAULT PRIVILEGES blanket grant.
  EXECUTE format($sql$
    ALTER TABLE %1$I.stock_locations            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.inventory_settings         ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.platform_location_defaults ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.stock_lots                 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.stock_transfers            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.stock_movements            ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "stock_locations_select" ON %1$I.stock_locations;
    CREATE POLICY "stock_locations_select" ON %1$I.stock_locations
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "stock_locations_write_admin" ON %1$I.stock_locations;
    CREATE POLICY "stock_locations_write_admin" ON %1$I.stock_locations
      FOR ALL
      USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'))
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'));

    DROP POLICY IF EXISTS "platform_location_defaults_select" ON %1$I.platform_location_defaults;
    CREATE POLICY "platform_location_defaults_select" ON %1$I.platform_location_defaults
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "platform_location_defaults_write_admin" ON %1$I.platform_location_defaults;
    CREATE POLICY "platform_location_defaults_write_admin" ON %1$I.platform_location_defaults
      FOR ALL
      USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'))
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'));

    DROP POLICY IF EXISTS "inventory_settings_select" ON %1$I.inventory_settings;
    CREATE POLICY "inventory_settings_select" ON %1$I.inventory_settings
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "stock_lots_select" ON %1$I.stock_lots;
    CREATE POLICY "stock_lots_select" ON %1$I.stock_lots
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "stock_movements_select" ON %1$I.stock_movements;
    CREATE POLICY "stock_movements_select" ON %1$I.stock_movements
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "stock_transfers_select" ON %1$I.stock_transfers;
    CREATE POLICY "stock_transfers_select" ON %1$I.stock_transfers
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "stock_transfers_insert" ON %1$I.stock_transfers;
    CREATE POLICY "stock_transfers_insert" ON %1$I.stock_transfers
      FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND created_by = auth.uid());
    DROP POLICY IF EXISTS "stock_transfers_delete" ON %1$I.stock_transfers;
    CREATE POLICY "stock_transfers_delete" ON %1$I.stock_transfers
      FOR DELETE USING (%1$I.is_tenant_member());

    GRANT SELECT ON %1$I.inventory_settings, %1$I.stock_lots, %1$I.stock_movements TO authenticated;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON %1$I.inventory_settings, %1$I.stock_lots, %1$I.stock_movements FROM anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON %1$I.stock_locations, %1$I.platform_location_defaults TO authenticated;
    GRANT SELECT, INSERT, DELETE ON %1$I.stock_transfers TO authenticated;
    REVOKE UPDATE, TRUNCATE ON %1$I.stock_transfers FROM anon, authenticated;
  $sql$, schema_name);

  -- @@ SECTION 3 @@

  -- @@ SECTION 4 @@

  -- @@ SECTION 5 @@

  -- ── Lock down EXECUTE on every function this installer owns ──
  -- Tenant schemas are exposed through PostgREST, so any function in them
  -- is callable as an RPC unless EXECUTE is revoked. Trigger functions do
  -- not need EXECUTE to fire; helpers are only called from SECURITY DEFINER
  -- code. The three public RPCs are re-granted below.
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = schema_name
      AND (p.proname LIKE 'inv\_%'
           OR p.proname IN ('enable_advanced_inventory', 'set_default_location', 'set_opening_lot_cost'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;

  -- @@ RPC GRANTS @@
END;
$inst$;

COMMENT ON FUNCTION public.install_advanced_inventory(text) IS
  'Idempotently installs advanced inventory (batches/locations/FIFO) into one tenant schema. See 047_advanced_inventory.sql.';

-- Only migrations (run as the owner) and provision_tenant_schema()
-- (SECURITY DEFINER, owner) call this. Never expose it as an RPC.
REVOKE ALL ON FUNCTION public.install_advanced_inventory(text) FROM PUBLIC, anon, authenticated;
