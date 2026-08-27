-- ============================================================
-- 035 — add platform_fee to sales, and close the 010 provisioning gap
--
-- New column: platform_fee numeric(12,2) — the marketplace's own commission
-- (eBay/Amazon final-value/referral fee), distinct from advertising_fee
-- (Promoted Listings / Sponsored Products spend). Same nullable, optional
-- shape as the other fee columns; computeNetProceeds (orderMath.ts) now
-- subtracts it too.
--
-- Also fixes a real, still-live drift found while adding this: migration
-- 010_order_fees.sql added shipping_cost/shipping_charged/advertising_fee
-- via run_on_all_tenant_schemas (after 027_reconcile_tenant_drift.sql fixed
-- 010's original hardcoded-tenant_kaufnest bug), but provision_tenant_schema()
-- in 005_tenant_provisioning.sql was never updated to include them in its
-- `sales` CREATE TABLE — so a tenant provisioned today would still be
-- missing all three, silently, until someone noticed. This migration's
-- run_on_all_tenant_schemas call below only fixes EXISTING tenants (already
-- confirmed live to have all three); 005 is fixed in the same commit so
-- newly-provisioned tenants get all four fee columns from day one.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists platform_fee numeric(12,2) check (platform_fee >= 0);
$$);
