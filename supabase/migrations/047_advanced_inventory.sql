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

  -- ── 3a. Ledger helpers ────────────────────────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.inv_raise(p_code text, p_detail text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_code || ': ' || p_detail;
    END;
    $func$;

    -- Serialises every ledger write for one (product, location): two synced
    -- orders for the same SKU cannot consume the same units.
    CREATE OR REPLACE FUNCTION %1$I.inv_lock(p_product uuid, p_location uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(p_product::text || ':' || p_location::text, 0));
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_location_holds_stock(p_location uuid)
    RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN coalesce((SELECT type <> 'dropship' FROM stock_locations WHERE id = p_location), false);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_last_unit_cost(p_product uuid)
    RETURNS numeric
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN coalesce((
        SELECT unit_cost FROM stock_lots
        WHERE product_id = p_product AND kind <> 'shortfall'
        ORDER BY received_at DESC, created_at DESC
        LIMIT 1), 0);
    END;
    $func$;

    -- The only two writers of sales.cogs_amount. inv_sale_before_write
    -- discards any cogs_amount change made while inv.writing_cogs is off.
    CREATE OR REPLACE FUNCTION %1$I.inv_set_cogs(p_sale uuid, p_value numeric)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      PERFORM set_config('inv.writing_cogs', 'on', true);
      UPDATE sales SET cogs_amount = p_value
        WHERE id = p_sale AND cogs_amount IS DISTINCT FROM p_value;
      PERFORM set_config('inv.writing_cogs', 'off', true);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_recompute_cogs(p_sale_ids uuid[])
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF p_sale_ids IS NULL OR cardinality(p_sale_ids) = 0 THEN
        RETURN;
      END IF;
      PERFORM set_config('inv.writing_cogs', 'on', true);
      UPDATE sales s
        SET cogs_amount = (
          SELECT round(coalesce(sum(-m.qty * m.unit_cost), 0), 2)
          FROM stock_movements m
          WHERE m.sale_id = s.id)
        WHERE s.id = ANY (p_sale_ids);
      PERFORM set_config('inv.writing_cogs', 'off', true);
    END;
    $func$;

    -- A new positive lot at a location first fills that location's
    -- shortfall: the oldest short sale movements are re-pointed to the new
    -- lot at its real cost and their orders' COGS recomputed. Invariant:
    -- a (product, location) never has both a shortfall and positive stock.
    CREATE OR REPLACE FUNCTION %1$I.inv_settle_shortfall(p_lot uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_lot  stock_lots;
      v_sf   stock_lots;
      m      record;
      v_take integer;
      v_q    integer;
      v_sale_ids uuid[] := '{}';
    BEGIN
      SELECT * INTO v_lot FROM stock_lots WHERE id = p_lot;
      IF NOT FOUND OR v_lot.kind = 'shortfall' OR v_lot.qty_remaining <= 0 THEN
        RETURN;
      END IF;
      PERFORM inv_lock(v_lot.product_id, v_lot.location_id);
      SELECT * INTO v_sf FROM stock_lots
        WHERE product_id = v_lot.product_id AND location_id = v_lot.location_id AND kind = 'shortfall'
        FOR UPDATE;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      v_take := least(-v_sf.qty_remaining, v_lot.qty_remaining);
      IF v_take <= 0 THEN
        RETURN;
      END IF;
      UPDATE stock_lots SET qty_remaining = qty_remaining - v_take WHERE id = v_lot.id;
      UPDATE stock_lots SET qty_remaining = qty_remaining + v_take WHERE id = v_sf.id;
      FOR m IN SELECT * FROM stock_movements WHERE lot_id = v_sf.id ORDER BY created_at, id LOOP
        EXIT WHEN v_take = 0;
        v_q := least(-m.qty, v_take);
        IF v_q = -m.qty THEN
          UPDATE stock_movements SET lot_id = v_lot.id, unit_cost = v_lot.unit_cost WHERE id = m.id;
        ELSE
          UPDATE stock_movements SET qty = qty + v_q WHERE id = m.id;
          INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, sale_id)
            VALUES (m.product_id, m.location_id, v_lot.id, 'sale', -v_q, v_lot.unit_cost, m.sale_id);
        END IF;
        v_take := v_take - v_q;
        v_sale_ids := array_append(v_sale_ids, m.sale_id);
      END LOOP;
      DELETE FROM stock_lots WHERE id = v_sf.id AND qty_remaining = 0;
      PERFORM inv_recompute_cogs(v_sale_ids);
    END;
    $func$;

    -- Set a lot's unit cost and cascade it: its movements, every lot
    -- transferred out of it (keeping each one's transfer-cost share in
    -- cost_addon), and the COGS of every sale that drew from any of them.
    CREATE OR REPLACE FUNCTION %1$I.inv_recost_lot(p_lot uuid, p_cost numeric)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_cost numeric := round(p_cost, 4);
      v_sale_ids uuid[];
      c record;
    BEGIN
      UPDATE stock_lots SET unit_cost = v_cost WHERE id = p_lot;
      UPDATE stock_movements SET unit_cost = v_cost WHERE lot_id = p_lot;
      SELECT array_agg(DISTINCT sale_id) INTO v_sale_ids
        FROM stock_movements WHERE lot_id = p_lot AND sale_id IS NOT NULL;
      PERFORM inv_recompute_cogs(v_sale_ids);
      FOR c IN SELECT id, cost_addon FROM stock_lots WHERE source_lot_id = p_lot LOOP
        PERFORM inv_recost_lot(c.id, v_cost + c.cost_addon);
      END LOOP;
    END;
    $func$;
  $sql$, schema_name);

  -- ── 3b. Purchases → lots ──────────────────────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.inv_landed_unit_cost(p %1$I.purchases)
    RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      -- Mirrored by src/app/dashboard/inventory/_lib/landedCost.ts.
      RETURN round(
        ((p.total_amount - coalesce(p.vat_amount, 0))
          + coalesce(p.freight_cost, 0) + coalesce(p.customs_cost, 0) + coalesce(p.other_cost, 0))
        / p.quantity, 4);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_should_have_lot(p %1$I.purchases)
    RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN p.product_id IS NOT NULL
        AND p.quantity > 0
        AND p.location_id IS NOT NULL
        AND inv_location_holds_stock(p.location_id);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_create_purchase_lot(p %1$I.purchases)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_lot  uuid;
      v_cost numeric := inv_landed_unit_cost(p);
    BEGIN
      PERFORM inv_lock(p.product_id, p.location_id);
      INSERT INTO stock_lots (product_id, location_id, purchase_id, kind, received_at, unit_cost, qty_received, qty_remaining)
        VALUES (p.product_id, p.location_id, p.id, 'purchase', p.date::timestamptz, v_cost, p.quantity, p.quantity)
        RETURNING id INTO v_lot;
      INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, purchase_id)
        VALUES (p.product_id, p.location_id, v_lot, 'receipt', p.quantity, v_cost, p.id);
      PERFORM inv_settle_shortfall(v_lot);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_drop_purchase_lot(p_purchase uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_lot stock_lots;
    BEGIN
      SELECT * INTO v_lot FROM stock_lots WHERE purchase_id = p_purchase AND kind = 'purchase' FOR UPDATE;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      IF v_lot.qty_remaining <> v_lot.qty_received THEN
        PERFORM inv_raise('INV_CONSUMED',
          (v_lot.qty_received - v_lot.qty_remaining) || ' of ' || v_lot.qty_received
          || ' units from this batch are already sold or transferred, so it cannot be removed or moved');
      END IF;
      DELETE FROM stock_lots WHERE id = v_lot.id; -- its receipt movement cascades
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_before_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.created_at < v_s.enabled_at THEN
        RETURN NEW;
      END IF;
      IF NEW.product_id IS NOT NULL AND NEW.location_id IS NULL THEN
        NEW.location_id := v_s.default_location_id;
      END IF;
      RETURN NEW;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_after_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s        inventory_settings;
      v_lot      stock_lots;
      v_want     boolean;
      v_consumed integer;
      v_cost     numeric;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NULL;
      END IF;
      v_want := inv_purchase_should_have_lot(NEW);

      IF TG_OP = 'INSERT' THEN
        IF v_want THEN
          PERFORM inv_create_purchase_lot(NEW);
        END IF;
        RETURN NULL;
      END IF;

      IF OLD.created_at < v_s.enabled_at THEN
        RETURN NULL; -- pre-enable rows are not part of the ledger
      END IF;

      -- Product deleted: its FK cascade is nulling purchases.product_id.
      -- stock_lots / stock_movements cascade from products on their own,
      -- so leave the ledger alone instead of raising INV_CONSUMED.
      IF NEW.product_id IS NULL AND OLD.product_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM products WHERE id = OLD.product_id) THEN
        RETURN NULL;
      END IF;

      SELECT * INTO v_lot FROM stock_lots WHERE purchase_id = NEW.id AND kind = 'purchase' FOR UPDATE;
      IF NOT FOUND THEN
        IF v_want THEN
          PERFORM inv_create_purchase_lot(NEW);
        END IF;
        RETURN NULL;
      END IF;

      IF NOT v_want
         OR NEW.product_id IS DISTINCT FROM OLD.product_id
         OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
        PERFORM inv_drop_purchase_lot(NEW.id); -- raises INV_CONSUMED if any unit is gone
        IF v_want THEN
          PERFORM inv_create_purchase_lot(NEW);
        END IF;
        RETURN NULL;
      END IF;

      IF NEW.quantity <> v_lot.qty_received THEN
        v_consumed := v_lot.qty_received - v_lot.qty_remaining;
        IF NEW.quantity < v_consumed THEN
          PERFORM inv_raise('INV_CONSUMED',
            v_consumed || ' units from this batch are already sold or transferred, so its quantity cannot go below '
            || v_consumed);
        END IF;
        UPDATE stock_lots SET qty_received = NEW.quantity, qty_remaining = NEW.quantity - v_consumed
          WHERE id = v_lot.id;
        UPDATE stock_movements SET qty = NEW.quantity WHERE lot_id = v_lot.id AND kind = 'receipt';
        IF NEW.quantity > v_lot.qty_received THEN
          PERFORM inv_settle_shortfall(v_lot.id);
        END IF;
      END IF;

      IF NEW.date IS DISTINCT FROM OLD.date THEN
        UPDATE stock_lots SET received_at = NEW.date::timestamptz WHERE purchase_id = NEW.id;
      END IF;

      v_cost := inv_landed_unit_cost(NEW);
      IF v_cost <> v_lot.unit_cost THEN
        PERFORM inv_recost_lot(v_lot.id, v_cost);
      END IF;
      RETURN NULL;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_before_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF coalesce(v_s.advanced_enabled, false) AND OLD.created_at >= v_s.enabled_at THEN
        PERFORM inv_drop_purchase_lot(OLD.id);
      END IF;
      RETURN OLD;
    END;
    $func$;

    -- One-way switch. Called only by POST /api/inventory/enable-advanced
    -- (service_role), which checks plan + admin role first.
    CREATE OR REPLACE FUNCTION %1$I.enable_advanced_inventory()
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s    inventory_settings;
      v_main uuid;
      v_lot  uuid;
      r      record;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id FOR UPDATE;
      IF v_s.advanced_enabled THEN
        RETURN;
      END IF;
      SELECT id INTO v_main FROM stock_locations WHERE lower(name) = 'main';
      IF v_main IS NULL THEN
        INSERT INTO stock_locations (name, type) VALUES ('Main', 'own') RETURNING id INTO v_main;
      END IF;
      INSERT INTO platform_location_defaults (platform, location_id)
        SELECT unnest(ARRAY['amazon', 'ebay', 'etsy', 'shopify', 'other']), v_main
        ON CONFLICT (platform) DO NOTHING;
      -- "Start clean": today's stock becomes one opening lot per product at
      -- cost 0, oldest in FIFO order. Cost is editable later via
      -- set_opening_lot_cost().
      FOR r IN SELECT id, current_stock FROM products WHERE current_stock > 0 LOOP
        INSERT INTO stock_lots (product_id, location_id, kind, received_at, unit_cost, qty_received, qty_remaining)
          VALUES (r.id, v_main, 'opening', timestamptz '1970-01-01 00:00:00+00', 0, r.current_stock, r.current_stock)
          RETURNING id INTO v_lot;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost)
          VALUES (r.id, v_main, v_lot, 'opening', r.current_stock, 0);
      END LOOP;
      UPDATE inventory_settings
        SET advanced_enabled = true, enabled_at = now(), default_location_id = v_main
        WHERE id;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS inv_purchase_before_write ON %1$I.purchases;
    CREATE TRIGGER inv_purchase_before_write BEFORE INSERT OR UPDATE ON %1$I.purchases
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_purchase_before_write();
    DROP TRIGGER IF EXISTS inv_purchase_after_write ON %1$I.purchases;
    CREATE TRIGGER inv_purchase_after_write AFTER INSERT OR UPDATE ON %1$I.purchases
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_purchase_after_write();
    DROP TRIGGER IF EXISTS inv_purchase_before_delete ON %1$I.purchases;
    CREATE TRIGGER inv_purchase_before_delete BEFORE DELETE ON %1$I.purchases
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_purchase_before_delete();
  $sql$, schema_name);

  -- ── 4. Sales → FIFO consumption ───────────────────────────
  EXECUTE format($sql$
    -- Same consumption rule as the legacy apply_sale_stock_change, plus:
    -- dropship locations never hold stock.
    CREATE OR REPLACE FUNCTION %1$I.inv_sale_consumes(
      p_product uuid, p_location uuid, p_qty integer, p_status text, p_restock boolean)
    RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN p_product IS NOT NULL
        AND p_location IS NOT NULL
        AND p_qty > 0
        AND inv_location_holds_stock(p_location)
        AND NOT (p_status = 'returned' AND coalesce(p_restock, false));
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_consume(p_product uuid, p_location uuid, p_qty integer, p_sale uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      l           record;
      v_remaining integer := p_qty;
      v_take      integer;
      v_sf        stock_lots;
    BEGIN
      IF p_qty <= 0 THEN
        RETURN;
      END IF;
      PERFORM inv_lock(p_product, p_location);
      FOR l IN
        SELECT * FROM stock_lots
        WHERE product_id = p_product AND location_id = p_location
          AND kind <> 'shortfall' AND qty_remaining > 0
        ORDER BY received_at, created_at, id
        FOR UPDATE
      LOOP
        v_take := least(l.qty_remaining, v_remaining);
        UPDATE stock_lots SET qty_remaining = qty_remaining - v_take WHERE id = l.id;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, sale_id)
          VALUES (p_product, p_location, l.id, 'sale', -v_take, l.unit_cost, p_sale);
        v_remaining := v_remaining - v_take;
        EXIT WHEN v_remaining = 0;
      END LOOP;

      IF v_remaining > 0 THEN
        -- Not enough stock: never block the order. The gap goes to this
        -- location's shortfall lot at the last known cost and is re-costed
        -- when stock next arrives (inv_settle_shortfall).
        INSERT INTO stock_lots (product_id, location_id, kind, received_at, unit_cost, qty_received, qty_remaining)
          VALUES (p_product, p_location, 'shortfall', now(), inv_last_unit_cost(p_product), 0, 0)
          ON CONFLICT (product_id, location_id) WHERE kind = 'shortfall' DO NOTHING;
        SELECT * INTO v_sf FROM stock_lots
          WHERE product_id = p_product AND location_id = p_location AND kind = 'shortfall'
          FOR UPDATE;
        UPDATE stock_lots SET qty_remaining = qty_remaining - v_remaining WHERE id = v_sf.id;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, sale_id)
          VALUES (p_product, p_location, v_sf.id, 'sale', -v_remaining, v_sf.unit_cost, p_sale);
      END IF;
    END;
    $func$;

    -- Undo every movement of one sale, returning units to the exact lots
    -- they came from. Restored units then settle any shortfall at the same
    -- location, so a location never shows positive and negative at once.
    CREATE OR REPLACE FUNCTION %1$I.inv_revert_sale(p_sale uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      m      record;
      v_lots uuid[] := '{}';
      v_lot  uuid;
    BEGIN
      FOR m IN SELECT * FROM stock_movements WHERE sale_id = p_sale ORDER BY created_at, id LOOP
        PERFORM inv_lock(m.product_id, m.location_id);
        UPDATE stock_lots SET qty_remaining = qty_remaining - m.qty WHERE id = m.lot_id;
        v_lots := array_append(v_lots, m.lot_id);
      END LOOP;
      DELETE FROM stock_movements WHERE sale_id = p_sale;
      DELETE FROM stock_lots WHERE id = ANY (v_lots) AND kind = 'shortfall' AND qty_remaining = 0;
      FOR v_lot IN
        SELECT id FROM stock_lots
        WHERE id = ANY (v_lots) AND kind <> 'shortfall' AND qty_remaining > 0
        ORDER BY received_at, created_at
      LOOP
        PERFORM inv_settle_shortfall(v_lot);
      END LOOP;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_sale_before_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      -- cogs_amount is trigger-owned: discard any value not written by
      -- inv_set_cogs / inv_recompute_cogs.
      IF coalesce(current_setting('inv.writing_cogs', true), 'off') <> 'on' THEN
        IF TG_OP = 'INSERT' THEN
          NEW.cogs_amount := NULL;
        ELSE
          NEW.cogs_amount := OLD.cogs_amount;
        END IF;
      END IF;

      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.created_at < v_s.enabled_at THEN
        RETURN NEW;
      END IF;
      IF NEW.product_id IS NOT NULL AND NEW.fulfillment_location_id IS NULL THEN
        NEW.fulfillment_location_id := coalesce(
          (SELECT location_id FROM platform_location_defaults WHERE platform = NEW.platform),
          v_s.default_location_id);
      END IF;
      RETURN NEW;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_sale_after_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s            inventory_settings;
      v_new_consumes boolean;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NULL;
      END IF;
      v_new_consumes := inv_sale_consumes(
        NEW.product_id, NEW.fulfillment_location_id, NEW.quantity, NEW.status, NEW.restock);

      IF TG_OP = 'UPDATE' THEN
        IF OLD.created_at < v_s.enabled_at THEN
          RETURN NULL; -- pre-enable rows are not part of the ledger
        END IF;
        -- Only stock-relevant edits re-run FIFO; a note/fee edit (or our own
        -- cogs_amount write) must never move an order onto different lots.
        IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id
           AND NEW.fulfillment_location_id IS NOT DISTINCT FROM OLD.fulfillment_location_id
           AND NEW.quantity = OLD.quantity
           AND v_new_consumes = inv_sale_consumes(
                 OLD.product_id, OLD.fulfillment_location_id, OLD.quantity, OLD.status, OLD.restock) THEN
          RETURN NULL;
        END IF;
        PERFORM inv_revert_sale(NEW.id);
      END IF;

      IF v_new_consumes THEN
        PERFORM inv_consume(NEW.product_id, NEW.fulfillment_location_id, NEW.quantity, NEW.id);
        PERFORM inv_recompute_cogs(ARRAY[NEW.id]);
      ELSIF NEW.product_id IS NOT NULL
            AND NEW.fulfillment_location_id IS NOT NULL
            AND inv_location_holds_stock(NEW.fulfillment_location_id) THEN
        PERFORM inv_set_cogs(NEW.id, 0);    -- e.g. returned + restocked
      ELSE
        PERFORM inv_set_cogs(NEW.id, NULL); -- dropship / no product: linked purchase applies
      END IF;
      RETURN NULL;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_sale_before_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF coalesce(v_s.advanced_enabled, false) THEN
        PERFORM inv_revert_sale(OLD.id);
      END IF;
      RETURN OLD;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS inv_sale_before_write ON %1$I.sales;
    CREATE TRIGGER inv_sale_before_write BEFORE INSERT OR UPDATE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_sale_before_write();
    DROP TRIGGER IF EXISTS inv_sale_after_write ON %1$I.sales;
    CREATE TRIGGER inv_sale_after_write AFTER INSERT OR UPDATE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_sale_after_write();
    DROP TRIGGER IF EXISTS inv_sale_before_delete ON %1$I.sales;
    CREATE TRIGGER inv_sale_before_delete BEFORE DELETE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_sale_before_delete();
  $sql$, schema_name);

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
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.enable_advanced_inventory() TO service_role', schema_name);
END;
$inst$;

COMMENT ON FUNCTION public.install_advanced_inventory(text) IS
  'Idempotently installs advanced inventory (batches/locations/FIFO) into one tenant schema. See 047_advanced_inventory.sql.';

-- Only migrations (run as the owner) and provision_tenant_schema()
-- (SECURITY DEFINER, owner) call this. Never expose it as an RPC.
REVOKE ALL ON FUNCTION public.install_advanced_inventory(text) FROM PUBLIC, anon, authenticated;
