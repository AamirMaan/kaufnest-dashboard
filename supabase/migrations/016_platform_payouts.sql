-- ============================================================
-- Platform payouts — all tenant schemas
--
-- Records eBay/Amazon → bank transfers. Subtracted from the
-- platform balance card on the Overview page to show "Pending"
-- (earned but not yet banked).
--
-- Uses run_on_all_tenant_schemas (applied in 012) so all live
-- tenants get the table. Also baked into provision_tenant_schema()
-- in 005_tenant_provisioning.sql for new tenants.
--
-- Idempotent: CREATE TABLE uses IF NOT EXISTS; policies use
-- DROP IF EXISTS before CREATE.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.platform_payouts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform     TEXT NOT NULL CHECK (platform IN ('ebay', 'amazon')),
    amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency     TEXT NOT NULL DEFAULT 'EUR',
    date         DATE NOT NULL,
    notes        TEXT,
    created_by   UUID REFERENCES {{schema}}.profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE {{schema}}.platform_payouts ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "platform_payouts_select" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_select"
    ON {{schema}}.platform_payouts FOR SELECT
    USING ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "platform_payouts_insert" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_insert"
    ON {{schema}}.platform_payouts FOR INSERT
    WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));

  DROP POLICY IF EXISTS "platform_payouts_delete" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_delete"
    ON {{schema}}.platform_payouts FOR DELETE
    USING ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));

  CREATE INDEX IF NOT EXISTS idx_platform_payouts_platform_date
    ON {{schema}}.platform_payouts (platform, date);
$$);
