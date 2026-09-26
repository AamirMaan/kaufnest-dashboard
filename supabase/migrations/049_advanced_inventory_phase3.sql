-- supabase/migrations/049_advanced_inventory_phase3.sql
-- ============================================================
-- Advanced inventory Phase 3: re-runs the updated installer (047) on every
-- tenant, adding the read RPCs inventory_stock_by_location /
-- inventory_stock_by_location_totals and making the sale trigger skip an
-- inactive platform default. Idempotent; inert for tenants that haven't
-- enabled advanced inventory.
-- Apply order: re-run 047 (redefines public.install_advanced_inventory),
-- then this file. New tenants get the same via provision_tenant_schema().
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_advanced_inventory('{{schema}}');
$$);
