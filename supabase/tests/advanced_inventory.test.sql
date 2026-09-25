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

  -- ── Section: purchases + enable (Task 5) ──────────────────
  -- Pre-enable history, backdated so it counts as "before enabled_at".
  INSERT INTO products (name, created_by) VALUES ('Widget', v_uid) RETURNING id INTO v_prod;
  INSERT INTO products (name, created_by) VALUES ('Gadget', v_uid) RETURNING id INTO v_prod2;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, created_at)
    VALUES ('Widget', v_prod, 5, 2, 10, current_date - 10, v_uid, now() - interval '1 day') RETURNING id INTO v_p1;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, created_at)
    VALUES ('Gadget', v_prod2, 4, 5, 20, current_date - 10, v_uid, now() - interval '1 day');
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by, created_at)
    VALUES ('ebay', 'Gadget', v_prod2, 1, 9, 9, current_date - 9, v_uid, now() - interval '1 day') RETURNING id INTO v_sg;

  IF EXISTS (SELECT 1 FROM stock_lots) OR EXISTS (SELECT 1 FROM stock_movements) THEN
    RAISE EXCEPTION 'FAIL purchases: ledger written while flag off';
  END IF;

  PERFORM enable_advanced_inventory();
  SELECT default_location_id INTO v_main FROM inventory_settings;
  IF v_main IS NULL OR NOT (SELECT advanced_enabled FROM inventory_settings) THEN
    RAISE EXCEPTION 'FAIL enable: flag or default location not set';
  END IF;
  SELECT count(*) INTO v_int FROM platform_location_defaults WHERE location_id = v_main;
  IF v_int <> 5 THEN RAISE EXCEPTION 'FAIL enable: expected 5 platform defaults, got %', v_int; END IF;
  SELECT qty_remaining INTO v_int FROM stock_lots WHERE product_id = v_prod AND kind = 'opening';
  IF v_int IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL enable: Widget opening lot should be 5, got %', v_int; END IF;
  SELECT qty_remaining INTO v_int FROM stock_lots WHERE product_id = v_prod2 AND kind = 'opening';
  IF v_int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL enable: Gadget opening lot should be 3, got %', v_int; END IF;
  PERFORM enable_advanced_inventory(); -- idempotent
  SELECT count(*) INTO v_int FROM stock_lots WHERE kind = 'opening';
  IF v_int <> 2 THEN RAISE EXCEPTION 'FAIL enable: re-enable duplicated opening lots (% lots)', v_int; END IF;

  -- New purchase: location defaults to Main; landed = (121 − 21 + 10 + 5 + 5) / 10 = 12
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, vat_amount,
                         freight_cost, customs_cost, other_cost, date, created_by)
    VALUES ('Widget', v_prod, 10, 12.10, 121, 21, 10, 5, 5, current_date - 5, v_uid) RETURNING id INTO v_p2;
  IF (SELECT location_id FROM purchases WHERE id = v_p2) IS DISTINCT FROM v_main THEN
    RAISE EXCEPTION 'FAIL purchases: location not defaulted to Main';
  END IF;
  SELECT unit_cost INTO v_num FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase';
  IF v_num IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'FAIL purchases: landed cost expected 12, got %', v_num; END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE purchase_id = v_p2 AND kind = 'receipt' AND qty = 10) THEN
    RAISE EXCEPTION 'FAIL purchases: receipt movement missing';
  END IF;

  -- Cost-only edit re-costs: (100 + 20 + 5 + 5) / 10 = 13
  UPDATE purchases SET freight_cost = 20 WHERE id = v_p2;
  SELECT unit_cost INTO v_num FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase';
  IF v_num IS DISTINCT FROM 13 THEN RAISE EXCEPTION 'FAIL purchases: re-cost expected 13, got %', v_num; END IF;

  -- Quantity edit: 12 units, net 120 + 30 extras = 150 / 12 = 12.5
  UPDATE purchases SET quantity = 12, total_amount = 145.20, vat_amount = 25.20 WHERE id = v_p2;
  IF (SELECT qty_received FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12
     OR (SELECT unit_cost FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12.5 THEN
    RAISE EXCEPTION 'FAIL purchases: quantity edit not applied to lot';
  END IF;

  -- Dropship purchase: no lot (and it stays — the Task 7 totals rely on it)
  INSERT INTO stock_locations (name, type) VALUES ('Supplier DS', 'dropship') RETURNING id INTO v_drop;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, location_id)
    VALUES ('Widget', v_prod, 2, 7, 14, current_date - 3, v_uid, v_drop) RETURNING id INTO v_p3;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE purchase_id = v_p3) THEN
    RAISE EXCEPTION 'FAIL purchases: dropship purchase created a lot';
  END IF;

  -- Unconsumed purchase can be deleted; its lot goes with it
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('Widget', v_prod, 3, 1, 3, current_date - 2, v_uid) RETURNING id INTO v_ptmp;
  DELETE FROM purchases WHERE id = v_ptmp;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE purchase_id = v_ptmp) THEN
    RAISE EXCEPTION 'FAIL purchases: deleted purchase left a lot behind';
  END IF;

  -- Pre-enable purchase edit is ignored by the ledger
  UPDATE purchases SET quantity = 6, total_amount = 30 WHERE product_id = v_prod2 AND created_at < now();
  IF EXISTS (SELECT 1 FROM stock_lots WHERE product_id = v_prod2 AND kind = 'purchase') THEN
    RAISE EXCEPTION 'FAIL purchases: pre-enable purchase edit created a lot';
  END IF;

  -- Deleting a product removes its lots with it (FK cascade), never INV_CONSUMED
  INSERT INTO products (name, created_by) VALUES ('Doomed', v_uid) RETURNING id INTO v_lot;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('Doomed', v_lot, 2, 1, 2, current_date, v_uid);
  DELETE FROM products WHERE id = v_lot;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE product_id = v_lot) THEN
    RAISE EXCEPTION 'FAIL purchases: product delete left lots behind';
  END IF;

  -- Internal functions are not callable by clients; enable is service_role only
  IF has_function_privilege('authenticated', 'tenant_zz_invtest.inv_raise(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'tenant_zz_invtest.enable_advanced_inventory()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL privileges: clients can execute internal functions';
  END IF;
  IF NOT has_function_privilege('service_role', 'tenant_zz_invtest.enable_advanced_inventory()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL privileges: service_role cannot enable';
  END IF;

  -- @@ NEXT SECTION @@

  RAISE EXCEPTION 'INV_TESTS_PASSED';
END
$test$;
