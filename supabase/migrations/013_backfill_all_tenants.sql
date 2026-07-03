-- Backfills migrations 004, 007, 008, 010, 011 across ALL tenant schemas.
--
-- PREREQUISITE: 012_tenant_migration_helper.sql must be applied first.
--
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- Safe to run even on tenant_kaufnest if some of these were already applied.
-- Covers: tenant_kaufnest, tenant_waqasmumtaz, tenant_hochkauf,
--         tenant_k2_textil, tenant_token — and any future tenants.

-- ============================================================
-- 007: company_profile invoice + banking fields
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.company_profile
    ADD COLUMN IF NOT EXISTS tax_id         text,
    ADD COLUMN IF NOT EXISTS phone          text,
    ADD COLUMN IF NOT EXISTS email          text,
    ADD COLUMN IF NOT EXISTS vat_rate       numeric NOT NULL DEFAULT 19,
    ADD COLUMN IF NOT EXISTS bank_name      text,
    ADD COLUMN IF NOT EXISTS iban           text,
    ADD COLUMN IF NOT EXISTS bic            text,
    ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV-',
    ADD COLUMN IF NOT EXISTS payment_terms  text NOT NULL DEFAULT '30 days',
    ADD COLUMN IF NOT EXISTS footer_notes   text;
$$);

-- ============================================================
-- 008: platform_connections table
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.platform_connections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform            text NOT NULL CHECK (platform IN ('ebay', 'amazon')),
    status              text NOT NULL DEFAULT 'disconnected'
                          CHECK (status IN ('connected', 'disconnected', 'error')),
    access_token        text,
    refresh_token       text,
    token_expires_at    timestamptz,
    external_account_id text,
    marketplace_id      text,
    last_synced_at      timestamptz,
    last_sync_status    text,
    last_sync_error     text,
    connected_by        uuid REFERENCES {{schema}}.profiles(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (platform)
  );
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE OR REPLACE TRIGGER set_platform_connections_updated_at
    BEFORE UPDATE ON {{schema}}.platform_connections
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
$$);

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.platform_connections ENABLE ROW LEVEL SECURITY;
$$);

SELECT public.run_on_all_tenant_schemas($$
  DROP POLICY IF EXISTS "platform_connections_all_admin" ON {{schema}}.platform_connections;
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE POLICY "platform_connections_all_admin" ON {{schema}}.platform_connections
    FOR ALL
    USING (
      {{schema}}.is_tenant_member()
      AND {{schema}}.current_user_role() IN ('admin', 'super_admin')
    )
    WITH CHECK (
      {{schema}}.is_tenant_member()
      AND {{schema}}.current_user_role() IN ('admin', 'super_admin')
    );
$$);

-- 008: external_order_id on sales
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS external_order_id text;
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_platform_external_order_id
    ON {{schema}}.sales (platform, external_order_id);
$$);

-- ============================================================
-- 010: order fee columns
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS shipping_cost    numeric(12,2) CHECK (shipping_cost    >= 0),
    ADD COLUMN IF NOT EXISTS shipping_charged numeric(12,2) CHECK (shipping_charged >= 0),
    ADD COLUMN IF NOT EXISTS advertising_fee  numeric(12,2) CHECK (advertising_fee  >= 0);
$$);

-- ============================================================
-- 004: performance indexes
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_sales_created_by
    ON {{schema}}.sales (created_by);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_sales_date_status
    ON {{schema}}.sales (date DESC, status);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_purchases_created_by
    ON {{schema}}.purchases (created_by);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_purchases_vendor
    ON {{schema}}.purchases (vendor);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_expenses_category
    ON {{schema}}.expenses (category);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_expenses_date_category
    ON {{schema}}.expenses (date DESC, category);
$$);

-- ============================================================
-- 011: pagination indexes
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
    ON {{schema}}.audit_logs (created_at DESC);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON {{schema}}.audit_logs (action);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
    ON {{schema}}.audit_logs (user_id);
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_products_name_asc
    ON {{schema}}.products (name ASC);
$$);
