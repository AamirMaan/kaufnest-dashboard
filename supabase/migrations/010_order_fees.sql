-- ============================================================
-- Order fee columns — tenant_kaufnest schema
-- Run this in the Supabase SQL editor for Project B.
--
-- Adds three nullable fee columns to sales:
--   shipping_cost    — shipping paid by seller (cost side).
--   shipping_charged — shipping billed to buyer (revenue side, on invoice).
--   advertising_fee  — per-order ad spend (eBay Promoted Listings / Amazon Ads).
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets these columns from the start — this file only needs to
-- run for tenant_kaufnest, which was provisioned before they existed.
--
-- All `add column if not exists` — safe to run against the live schema.
-- ============================================================

-- FIXED 2026-08-03: this block previously hardcoded `tenant_kaufnest`, which is
-- why tenant_testing never received these columns. It now uses the fan-out
-- helper, per the rule in AGENTS.md. Re-running is safe (idempotent).

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists shipping_cost    numeric(12,2) check (shipping_cost    >= 0),
    add column if not exists shipping_charged numeric(12,2) check (shipping_charged >= 0),
    add column if not exists advertising_fee  numeric(12,2) check (advertising_fee  >= 0);

  comment on column {{schema}}.sales.shipping_cost    is 'Shipping cost paid by seller. NULL = not recorded.';
  comment on column {{schema}}.sales.shipping_charged is 'Shipping billed to buyer (revenue side, appears on invoice). NULL = not recorded.';
  comment on column {{schema}}.sales.advertising_fee  is 'Per-order ad fee (eBay Promoted Listings / Amazon Ads). NULL = not recorded.';
$$);

-- ============================================================
-- Update provision_tenant_schema() so every FUTURE tenant also
-- gets these columns at schema-creation time.
--
-- This is a full replacement of the function body (copy of 005 as
-- amended by 006–009, with the three new columns added to the sales
-- CREATE TABLE). Do NOT run the block above for future tenants —
-- it targets tenant_kaufnest explicitly; provision_tenant_schema()
-- handles all others.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provision_tenant_schema(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tbl text;
  pol record;
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  -- ── 1. Tables (order matters for FK constraints) ──────────

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.profiles (
      id         uuid PRIMARY KEY,
      email      text NOT NULL,
      full_name  text NOT NULL DEFAULT '',
      role       text NOT NULL DEFAULT 'accountant'
                   CHECK (role IN ('super_admin', 'admin', 'accountant')),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.products (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name              text NOT NULL UNIQUE,
      sku               text,
      current_stock     integer NOT NULL DEFAULT 0,
      reorder_threshold integer,
      created_by        uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.expenses (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title       text NOT NULL,
      amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
      currency    text NOT NULL DEFAULT 'EUR',
      category    text NOT NULL,
      vendor      text,
      date        date NOT NULL,
      description text,
      created_by  uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      vat_rate    numeric(5,2),
      vat_amount  numeric(12,2)
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.sales (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      platform          text NOT NULL,
      product_name      text NOT NULL,
      product_id        uuid REFERENCES %1$I.products(id) ON DELETE SET NULL,
      quantity          integer NOT NULL CHECK (quantity > 0),
      unit_price        numeric(12,2) NOT NULL CHECK (unit_price >= 0),
      total_amount      numeric(12,2) NOT NULL,
      currency          text NOT NULL DEFAULT 'EUR',
      date              date NOT NULL,
      description       text,
      created_by        uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      vat_rate          numeric(5,2),
      vat_amount        numeric(12,2),
      status            text NOT NULL DEFAULT 'pending',
      restock           boolean NOT NULL DEFAULT false,
      external_order_id text,
      shipping_cost     numeric(12,2) CHECK (shipping_cost    >= 0),
      shipping_charged  numeric(12,2) CHECK (shipping_charged >= 0),
      advertising_fee   numeric(12,2) CHECK (advertising_fee  >= 0)
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.purchases (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_name text NOT NULL,
      product_id   uuid REFERENCES %1$I.products(id) ON DELETE SET NULL,
      quantity     integer NOT NULL CHECK (quantity > 0),
      unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
      total_amount numeric(12,2) NOT NULL,
      currency     text NOT NULL DEFAULT 'EUR',
      vendor       text,
      date         date NOT NULL,
      description  text,
      created_by   uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      vat_rate     numeric(5,2),
      vat_amount   numeric(12,2)
    )
  $sql$, schema_name);

  -- NOTE: user_id is nullable here to match audit_logs' `on delete set null`
  -- pattern used elsewhere (a deleted user shouldn't break their audit trail).
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.audit_logs (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid,
      user_email  text,
      action      text NOT NULL,
      entity_type text NOT NULL,
      entity_id   uuid,
      metadata    jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.company_profile (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name           text NOT NULL,
      logo_url       text,
      vat_number     text,
      tax_id         text,
      address        text,
      phone          text,
      email          text,
      currency       text NOT NULL DEFAULT 'EUR',
      timezone       text NOT NULL DEFAULT 'UTC',
      vat_rate       numeric NOT NULL DEFAULT 19,
      bank_name      text,
      iban           text,
      bic            text,
      invoice_prefix text NOT NULL DEFAULT 'INV-',
      payment_terms  text NOT NULL DEFAULT '30 days',
      footer_notes   text,
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- platform_connections: one row per platform (ebay/amazon) holding OAuth
  -- tokens for the tenant's connected seller account. Tokens are sensitive —
  -- see section 5 below, RLS restricts ALL operations (incl. SELECT) to
  -- admin/super_admin, unlike company_profile which allows SELECT for any
  -- tenant member.
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.platform_connections (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      platform             text NOT NULL CHECK (platform IN ('ebay', 'amazon')),
      status               text NOT NULL DEFAULT 'disconnected'
                             CHECK (status IN ('connected', 'disconnected', 'error')),
      access_token         text,
      refresh_token        text,
      token_expires_at     timestamptz,
      external_account_id  text,
      marketplace_id       text,
      last_synced_at       timestamptz,
      last_sync_status     text,
      last_sync_error      text,
      connected_by         uuid REFERENCES %1$I.profiles(id),
      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now(),
      UNIQUE (platform)
    )
  $sql$, schema_name);

  -- ── 2. updated_at triggers (reuse schema-agnostic public.set_updated_at) ──

  EXECUTE format('CREATE OR REPLACE TRIGGER set_expenses_updated_at BEFORE UPDATE ON %1$I.expenses FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_purchases_updated_at BEFORE UPDATE ON %1$I.purchases FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_sales_updated_at BEFORE UPDATE ON %1$I.sales FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_products_updated_at BEFORE UPDATE ON %1$I.products FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_platform_connections_updated_at BEFORE UPDATE ON %1$I.platform_connections FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);

  -- ── 3. Tenant-membership + role helper functions ──────────
  -- is_tenant_member(): caller's JWT app_metadata.tenant_schema must equal
  -- this schema. Closes the gap left by provision_tenant_schema's own
  -- 'tenant_%' prefix check — without this, an authenticated user from a
  -- *different* tenant could read this schema's tables via
  -- `db: { schema: schema_name }` directly.

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.is_tenant_member()
    RETURNS boolean
    LANGUAGE sql STABLE
    AS $func$
      SELECT COALESCE(
        (auth.jwt() -> 'app_metadata' ->> 'tenant_schema') = %1$L,
        false
      );
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.current_user_role()
    RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
      SELECT role FROM profiles WHERE id = auth.uid();
    $func$;
  $sql$, schema_name);

  -- ── 4. Stock-sync triggers ─────────────────────────────────
  -- Same INSERT/UPDATE/DELETE-aware logic as the public schema
  -- (002_inventory_and_vat.sql / 003_add_order_status.sql): each function
  -- reverses the OLD row's stock effect and applies the NEW row's effect,
  -- handling inserts, quantity edits, re-linking to a different product, and
  -- deletes in a single code path. Sales already account for the
  -- returned+restock case from the start (delta = 0 when
  -- status = 'returned' AND restock, else -quantity).

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.apply_purchase_stock_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF (TG_OP = 'INSERT') THEN
        IF NEW.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock + NEW.quantity
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock - OLD.quantity
            WHERE id = OLD.product_id;
        END IF;
        IF NEW.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock + NEW.quantity
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock - OLD.quantity
            WHERE id = OLD.product_id;
        END IF;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.apply_sale_stock_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      old_delta integer;
      new_delta integer;
    BEGIN
      IF (TG_OP = 'INSERT') THEN
        IF NEW.product_id IS NOT NULL THEN
          new_delta := CASE WHEN NEW.status = 'returned' AND NEW.restock THEN 0 ELSE -NEW.quantity END;
          UPDATE products SET current_stock = current_stock + new_delta
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.product_id IS NOT NULL THEN
          old_delta := CASE WHEN OLD.status = 'returned' AND OLD.restock THEN 0 ELSE -OLD.quantity END;
          UPDATE products SET current_stock = current_stock - old_delta
            WHERE id = OLD.product_id;
        END IF;
        IF NEW.product_id IS NOT NULL THEN
          new_delta := CASE WHEN NEW.status = 'returned' AND NEW.restock THEN 0 ELSE -NEW.quantity END;
          UPDATE products SET current_stock = current_stock + new_delta
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.product_id IS NOT NULL THEN
          old_delta := CASE WHEN OLD.status = 'returned' AND OLD.restock THEN 0 ELSE -OLD.quantity END;
          UPDATE products SET current_stock = current_stock - old_delta
            WHERE id = OLD.product_id;
        END IF;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format('CREATE OR REPLACE TRIGGER purchases_stock_change AFTER INSERT OR UPDATE OR DELETE ON %1$I.purchases FOR EACH ROW EXECUTE PROCEDURE %1$I.apply_purchase_stock_change()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER sales_stock_change AFTER INSERT OR UPDATE OR DELETE ON %1$I.sales FOR EACH ROW EXECUTE PROCEDURE %1$I.apply_sale_stock_change()', schema_name);

  -- ── 5. Row-Level Security ──────────────────────────────────

  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections']
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', schema_name, tbl);
  END LOOP;

  -- Drop any policies left over from a previous failed/partial provisioning
  -- attempt at this schema_name — CREATE POLICY has no IF NOT EXISTS/OR
  -- REPLACE, so without this a retry errors with "policy ... already exists".
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = schema_name
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, schema_name, pol.tablename);
  END LOOP;

  -- profiles
  EXECUTE format('CREATE POLICY "profiles_select_self" ON %1$I.profiles FOR SELECT USING (%1$I.is_tenant_member() AND id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "profiles_select_admin" ON %1$I.profiles FOR SELECT USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "profiles_update_self" ON %1$I.profiles FOR UPDATE USING (%1$I.is_tenant_member() AND id = auth.uid()) WITH CHECK (%1$I.is_tenant_member() AND id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "profiles_manage_super_admin" ON %1$I.profiles FOR ALL USING (%1$I.is_tenant_member() AND %1$I.current_user_role() = ''super_admin'')', schema_name);

  -- expenses
  EXECUTE format('CREATE POLICY "expenses_select" ON %1$I.expenses FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "expenses_insert" ON %1$I.expenses FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "expenses_update" ON %1$I.expenses FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "expenses_delete" ON %1$I.expenses FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- purchases
  EXECUTE format('CREATE POLICY "purchases_select" ON %1$I.purchases FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "purchases_insert" ON %1$I.purchases FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "purchases_update" ON %1$I.purchases FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "purchases_delete" ON %1$I.purchases FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- sales
  EXECUTE format('CREATE POLICY "sales_select" ON %1$I.sales FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "sales_insert" ON %1$I.sales FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "sales_update" ON %1$I.sales FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "sales_delete" ON %1$I.sales FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- products
  EXECUTE format('CREATE POLICY "products_select" ON %1$I.products FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "products_insert" ON %1$I.products FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "products_update" ON %1$I.products FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "products_delete" ON %1$I.products FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- audit_logs
  EXECUTE format('CREATE POLICY "audit_logs_select" ON %1$I.audit_logs FOR SELECT USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "audit_logs_insert" ON %1$I.audit_logs FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);

  -- company_profile
  EXECUTE format('CREATE POLICY "company_profile_select" ON %1$I.company_profile FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "company_profile_update" ON %1$I.company_profile FOR UPDATE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- platform_connections — contains OAuth tokens, admin/super_admin only for
  -- every operation including SELECT.
  EXECUTE format('CREATE POLICY "platform_connections_all_admin" ON %1$I.platform_connections FOR ALL USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin'')) WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- ── 6. Indexes ──────────────────────────────────────────────
  -- Same set as public (see 002_inventory_and_vat.sql, 003_add_order_status.sql,
  -- 004_performance_indexes.sql) — every tenant gets the growth-oriented
  -- created_by/category/vendor/(date,status)/(date,category) indexes from
  -- the start. Index names only need to be unique within their own schema,
  -- so no per-tenant prefix is needed.

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_date ON %1$I.expenses (date DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON %1$I.expenses (created_by)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_category ON %1$I.expenses (category)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_date_category ON %1$I.expenses (date DESC, category)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_date ON %1$I.purchases (date DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_product ON %1$I.purchases (product_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_created_by ON %1$I.purchases (created_by)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON %1$I.purchases (vendor)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_date ON %1$I.sales (date DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_platform ON %1$I.sales (platform)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_product ON %1$I.sales (product_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_status ON %1$I.sales (status)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_created_by ON %1$I.sales (created_by)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_date_status ON %1$I.sales (date DESC, status)', schema_name);

  -- Non-partial unique index: Postgres treats multiple NULLs as distinct, so
  -- manually-created/imported sales (external_order_id IS NULL) are
  -- unaffected, while platform-synced rows can be upserted idempotently via
  -- .upsert(rows, { onConflict: "platform,external_order_id" }).
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_platform_external_order_id ON %1$I.sales (platform, external_order_id)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_products_name ON %1$I.products (name)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON %1$I.audit_logs (user_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON %1$I.audit_logs (entity_type, entity_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON %1$I.audit_logs (created_at DESC)', schema_name);

  -- ── 7. Grants ───────────────────────────────────────────────
  -- create schema does NOT grant anything by default — without this every
  -- PostgREST request against the new schema fails with "permission denied
  -- for schema ..." (42501) before RLS is even evaluated.

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO anon, authenticated, service_role', schema_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO anon, authenticated, service_role', schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role', schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role', schema_name);

END;
$$;
