-- supabase/migrations/048_advanced_inventory_apply.sql
-- ============================================================
-- Installs advanced inventory (047) into every existing tenant schema.
-- Safe on live data: adds nullable columns, empty tables and triggers that
-- are no-ops until a tenant runs enable_advanced_inventory(). New tenants
-- get the same via provision_tenant_schema() (005, same commit).
-- Requires 047 applied first.
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_advanced_inventory('{{schema}}');
$$);
