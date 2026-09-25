-- supabase/tests/advanced_inventory.test.sql
-- ============================================================
-- Advanced inventory trigger tests. ONE DO block against a throwaway
-- schema (tenant_zz_invtest). It ends by raising INV_TESTS_PASSED, which
-- rolls EVERYTHING back — schema included — so it is safe to run against
-- the live Project B database.
--
-- Expected result: an error whose message is exactly 'INV_TESTS_PASSED'.
-- 'FAIL …' = a failing assertion. Anything else = a bug.
--
-- Prerequisite: supabase/migrations/047_advanced_inventory.sql executed
-- (it only defines public.install_advanced_inventory; no tenant touched).
-- Sections are cumulative — later sections rely on state from earlier ones.
-- ============================================================
DO $test$
DECLARE
  v_uid   uuid := gen_random_uuid();
  v_prod  uuid;  -- "Widget"
  v_prod2 uuid;  -- "Gadget" (pre-enable history)
  v_main  uuid;
  v_fba   uuid;
  v_drop  uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_ptmp uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_sd uuid; v_sa uuid; v_sg uuid;
  v_t1 uuid;
  v_lot uuid;
  v_num numeric;
  v_int integer;
  v_txt text;
BEGIN
  PERFORM public.provision_tenant_schema('tenant_zz_invtest');
  PERFORM public.install_advanced_inventory('tenant_zz_invtest');
  PERFORM set_config('search_path', 'tenant_zz_invtest, public', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_schema', 'tenant_zz_invtest'))::text, true);
  INSERT INTO profiles (id, email, role) VALUES (v_uid, 'inv-test@example.invalid', 'admin');

  -- ── Section: schema (Task 4) ──────────────────────────────
  SELECT count(*) INTO v_int FROM inventory_settings;
  IF v_int <> 1 THEN RAISE EXCEPTION 'FAIL schema: expected 1 settings row, got %', v_int; END IF;
  IF (SELECT advanced_enabled FROM inventory_settings) THEN
    RAISE EXCEPTION 'FAIL schema: advanced_enabled should default to false';
  END IF;
  PERFORM location_id, freight_cost, customs_cost, other_cost FROM purchases LIMIT 0;
  PERFORM fulfillment_location_id, cogs_amount FROM sales LIMIT 0;
  BEGIN
    INSERT INTO stock_locations (name, type) VALUES ('Bogus', 'moon');
    RAISE EXCEPTION 'FAIL schema: bogus location type accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'tenant_zz_invtest.stock_lots'::regclass) THEN
    RAISE EXCEPTION 'FAIL schema: RLS not enabled on stock_lots';
  END IF;
  IF has_table_privilege('authenticated', 'tenant_zz_invtest.stock_lots', 'INSERT')
     OR has_table_privilege('authenticated', 'tenant_zz_invtest.stock_movements', 'UPDATE')
     OR has_table_privilege('authenticated', 'tenant_zz_invtest.inventory_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL schema: clients can write ledger tables';
  END IF;
  IF NOT has_table_privilege('authenticated', 'tenant_zz_invtest.stock_transfers', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL schema: clients cannot insert transfers';
  END IF;
  PERFORM public.install_advanced_inventory('tenant_zz_invtest'); -- idempotent re-run

  -- @@ NEXT SECTION @@

  RAISE EXCEPTION 'INV_TESTS_PASSED';
END
$test$;
