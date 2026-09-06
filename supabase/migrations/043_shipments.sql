-- ============================================================
-- Shipments — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- Backs the shipping-label-generation feature (src/lib/shipping/,
-- src/app/api/shipping/*, src/app/dashboard/sales/[id]/page.tsx's Shipping
-- card) — one row per purchased EasyPost label. A sale has at most one
-- shipment in v1 (no re-generate/refund/void flow — see the design spec's
-- explicit scope note), but this is NOT enforced by a unique constraint on
-- sale_id: nothing in the app needs one today, and baking in an unenforced
-- assumption as a DB constraint would only block a future re-generate
-- feature for no benefit now.
--
-- RLS mirrors platform_payouts' shape (008_platform_integrations.sql /
-- 005_tenant_provisioning.sql): every tenant member can read (a shipment's
-- tracking number/cost is order information, not a secret like an OAuth
-- token — unlike platform_connections), but only admin/super_admin can
-- write — same role bar as the "Generate Shipping Label" button and the
-- requireIntegrationAdmin() guard on both API routes. No UPDATE/DELETE
-- policy: v1 has no edit/void/refund flow for a purchased label, so there
-- is nothing for either policy to protect yet.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets this table from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.shipments (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id              uuid NOT NULL REFERENCES {{schema}}.sales(id) ON DELETE CASCADE,
    carrier              text NOT NULL,
    service              text NOT NULL,
    tracking_number      text NOT NULL,
    label_url            text NOT NULL,
    label_format         text NOT NULL DEFAULT 'PDF',
    cost                 numeric(10,2),
    cost_currency        text,
    weight_oz            numeric(10,2) NOT NULL,
    easypost_shipment_id text NOT NULL,
    created_by           uuid NOT NULL REFERENCES {{schema}}.profiles(id),
    created_at           timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_shipments_sale_id ON {{schema}}.shipments(sale_id);

  ALTER TABLE {{schema}}.shipments ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "shipments_select" ON {{schema}}.shipments;
  CREATE POLICY "shipments_select" ON {{schema}}.shipments
    FOR SELECT USING ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "shipments_insert" ON {{schema}}.shipments;
  CREATE POLICY "shipments_insert" ON {{schema}}.shipments
    FOR INSERT WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));
$$);
