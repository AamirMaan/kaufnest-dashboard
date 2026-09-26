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
  v_gq  integer;  -- Gadget units at Main before the Task 11 section
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
  SELECT count(*) INTO v_int FROM pg_constraint
    WHERE conrelid = 'tenant_zz_invtest.purchases'::regclass AND contype = 'f'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'tenant_zz_invtest.purchases'::regclass AND attname = 'location_id')];
  IF v_int <> 1 THEN RAISE EXCEPTION 'FAIL schema: installer re-run duplicated purchases.location_id FK (% FKs)', v_int; END IF;

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
  IF (SELECT qty_received FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 12
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 12
     OR (SELECT unit_cost FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 12.5 THEN
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

  -- ── Section: sales (Task 6) ───────────────────────────────
  -- FIFO split: 7 = 5 opening @0 + 2 from P2 @12.5 → COGS 25.00
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 7, 30, 210, current_date, v_uid) RETURNING id INTO v_s1;
  IF (SELECT fulfillment_location_id FROM sales WHERE id = v_s1) IS DISTINCT FROM v_main THEN
    RAISE EXCEPTION 'FAIL sales: fulfillment location not defaulted';
  END IF;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s1;
  IF v_num IS DISTINCT FROM 25.00 THEN RAISE EXCEPTION 'FAIL sales: FIFO COGS expected 25.00, got %', v_num; END IF;
  IF (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') IS DISTINCT FROM 0
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FAIL sales: FIFO did not drain the oldest lot first';
  END IF;

  -- Clients cannot write cogs_amount
  UPDATE sales SET cogs_amount = 999 WHERE id = v_s1;
  IF (SELECT cogs_amount FROM sales WHERE id = v_s1) IS DISTINCT FROM 25.00 THEN
    RAISE EXCEPTION 'FAIL sales: client write to cogs_amount stuck';
  END IF;

  -- Unrelated edit leaves the ledger untouched
  SELECT string_agg(id::text, ',' ORDER BY id) INTO v_txt FROM stock_movements WHERE sale_id = v_s1;
  UPDATE sales SET description = 'gift wrap' WHERE id = v_s1;
  IF (SELECT string_agg(id::text, ',' ORDER BY id) FROM stock_movements WHERE sale_id = v_s1) IS DISTINCT FROM v_txt THEN
    RAISE EXCEPTION 'FAIL sales: unrelated edit re-ran FIFO';
  END IF;

  -- Quantity edit re-runs FIFO: 3 units, all from opening @0
  UPDATE sales SET quantity = 3, total_amount = 90 WHERE id = v_s1;
  IF (SELECT cogs_amount FROM sales WHERE id = v_s1) IS DISTINCT FROM 0
     OR (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') IS DISTINCT FROM 2
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'FAIL sales: quantity edit did not revert and re-apply';
  END IF;

  -- 13 more: 2 opening + 11 from P2 @12.5 → 137.50; P2 left with 1
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 13, 30, 390, current_date, v_uid) RETURNING id INTO v_s2;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s2;
  IF v_num IS DISTINCT FROM 137.50 THEN RAISE EXCEPTION 'FAIL sales: s2 COGS expected 137.50, got %', v_num; END IF;

  -- Consumed batch: cannot shrink below consumed, cannot delete
  BEGIN
    UPDATE purchases SET quantity = 5, total_amount = 60.50, vat_amount = 10.50 WHERE id = v_p2;
    RAISE EXCEPTION 'FAIL sales: shrinking a consumed batch was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_CONSUMED:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM purchases WHERE id = v_p2;
    RAISE EXCEPTION 'FAIL sales: deleting a consumed batch was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_CONSUMED:%' THEN RAISE; END IF;
  END;

  -- Batch cost edit flows into COGS already booked: (120 + 20 + 5 + 17) / 12 = 13.5 → s2 = 11 × 13.5
  UPDATE purchases SET other_cost = 17 WHERE id = v_p2;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s2;
  IF v_num IS DISTINCT FROM 148.50 THEN RAISE EXCEPTION 'FAIL sales: re-cost expected 148.50, got %', v_num; END IF;

  -- Shortfall: 4 wanted, 1 left → 1 @13.5 + 3 short @ last cost 13.5 = 54.00
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 4, 30, 120, current_date, v_uid) RETURNING id INTO v_s3;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s3;
  IF v_num IS DISTINCT FROM 54.00 THEN RAISE EXCEPTION 'FAIL sales: shortfall COGS expected 54.00, got %', v_num; END IF;
  SELECT qty_remaining INTO v_int FROM stock_lots WHERE product_id = v_prod AND location_id = v_main AND kind = 'shortfall';
  IF v_int IS DISTINCT FROM -3 THEN RAISE EXCEPTION 'FAIL sales: shortfall lot expected -3, got %', v_int; END IF;

  -- A receipt settles the shortfall and re-costs the order at the real price: 13.5 + 3 × 10 = 43.50
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('Widget', v_prod, 10, 10, 100, current_date, v_uid) RETURNING id INTO v_p4;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE product_id = v_prod AND kind = 'shortfall') THEN
    RAISE EXCEPTION 'FAIL sales: shortfall not settled by receipt';
  END IF;
  IF (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'FAIL sales: settlement did not draw 3 from the new lot';
  END IF;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s3;
  IF v_num IS DISTINCT FROM 43.50 THEN RAISE EXCEPTION 'FAIL sales: settled COGS expected 43.50, got %', v_num; END IF;

  -- Deleting a sale puts its units back where they came from
  DELETE FROM sales WHERE id = v_s3;
  IF (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 1
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FAIL sales: delete did not restore lots';
  END IF;

  -- Returned + restock consumes nothing; COGS 0; its 3 opening units come back
  UPDATE sales SET status = 'returned', restock = true WHERE id = v_s1;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_s1)
     OR (SELECT cogs_amount FROM sales WHERE id = v_s1) IS DISTINCT FROM 0
     OR (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL sales: returned+restock not handled';
  END IF;

  -- Dropship fulfilment: no movements, COGS stays NULL (linked purchase applies)
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by, fulfillment_location_id)
    VALUES ('ebay', 'Widget', v_prod, 2, 30, 60, current_date, v_uid, v_drop) RETURNING id INTO v_sd;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_sd) OR (SELECT cogs_amount FROM sales WHERE id = v_sd) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL sales: dropship sale touched the ledger';
  END IF;

  -- Platform default: Amazon → FBA (empty) → shortfall at FBA @ last cost 10
  INSERT INTO stock_locations (name, type) VALUES ('Amazon FBA', 'fba') RETURNING id INTO v_fba;
  UPDATE platform_location_defaults SET location_id = v_fba WHERE platform = 'amazon';
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('amazon', 'Widget', v_prod, 1, 30, 30, current_date, v_uid) RETURNING id INTO v_sa;
  IF (SELECT fulfillment_location_id FROM sales WHERE id = v_sa) IS DISTINCT FROM v_fba
     OR (SELECT cogs_amount FROM sales WHERE id = v_sa) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FAIL sales: platform default / FBA shortfall wrong';
  END IF;
  DELETE FROM sales WHERE id = v_sa;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE location_id = v_fba) THEN
    RAISE EXCEPTION 'FAIL sales: empty shortfall lot left behind at FBA';
  END IF;

  -- Pre-enable sale edits are ignored by the ledger
  UPDATE sales SET quantity = 2, total_amount = 18 WHERE id = v_sg;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_sg) THEN
    RAISE EXCEPTION 'FAIL sales: pre-enable sale edit touched the ledger';
  END IF;

  -- Triggers still fire for a real client role (EXECUTE was revoked on them)
  SET LOCAL ROLE authenticated;
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 1, 30, 30, current_date, v_uid) RETURNING id INTO v_sa;
  RESET ROLE;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) IS NULL THEN
    RAISE EXCEPTION 'FAIL sales: trigger did not run for the authenticated role';
  END IF;
  DELETE FROM sales WHERE id = v_sa;

  -- ── Section: transfers, locations, RPCs (Task 7) ──────────
  -- 5 Main → FBA with €10 transfer cost (+2/unit): FIFO takes opening 3 @0, P2 1 @13.5, P4 1 @10
  INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, transfer_cost, date, created_by)
    VALUES (v_prod, v_main, v_fba, 5, 10, current_date, v_uid) RETURNING id INTO v_t1;
  SELECT count(*), sum(qty_remaining) INTO v_int, v_num FROM stock_lots WHERE location_id = v_fba;
  IF v_int <> 3 OR v_num IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL transfers: expected 3 lots / 5 units at FBA, got % / %', v_int, v_num; END IF;
  SELECT string_agg(unit_cost::text, ',' ORDER BY received_at, created_at) INTO v_txt FROM stock_lots WHERE location_id = v_fba;
  IF v_txt IS DISTINCT FROM '2.0000,15.5000,12.0000' THEN RAISE EXCEPTION 'FAIL transfers: destination costs wrong: %', v_txt; END IF;
  IF (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'FAIL transfers: source not drained FIFO';
  END IF;

  -- A sale at FBA consumes the transferred opening units first: 2 × 2 = 4.00
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('amazon', 'Widget', v_prod, 2, 30, 60, current_date, v_uid) RETURNING id INTO v_sa;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FAIL transfers: FBA sale COGS expected 4.00';
  END IF;

  -- Opening cost edit flows through the transfer lot: (1 + 2) × 2 = 6.00
  SELECT id INTO v_lot FROM stock_lots WHERE product_id = v_prod AND kind = 'opening';
  PERFORM set_opening_lot_cost(v_lot, 1);
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'FAIL transfers: opening re-cost did not reach the FBA sale';
  END IF;
  BEGIN
    PERFORM set_opening_lot_cost((SELECT id FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase'), 1);
    RAISE EXCEPTION 'FAIL rpc: set_opening_lot_cost accepted a purchase lot';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_NOT_OPENING:%' THEN RAISE; END IF;
  END;

  -- Transfers are immutable, and cannot be deleted once their units are sold
  BEGIN
    UPDATE stock_transfers SET note = 'x' WHERE id = v_t1;
    RAISE EXCEPTION 'FAIL transfers: edit allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_TRANSFER_IMMUTABLE:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM stock_transfers WHERE id = v_t1;
    RAISE EXCEPTION 'FAIL transfers: delete of a consumed transfer allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_CONSUMED:%' THEN RAISE; END IF;
  END;

  -- Once the sale is gone the transfer can be deleted, restoring Main exactly
  DELETE FROM sales WHERE id = v_sa;
  DELETE FROM stock_transfers WHERE id = v_t1;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE location_id = v_fba)
     OR (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') IS DISTINCT FROM 3
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') IS DISTINCT FROM 1
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FAIL transfers: delete did not restore the source';
  END IF;

  -- Insufficient source stock and dropship endpoints are rejected
  BEGIN
    INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, date, created_by)
      VALUES (v_prod, v_main, v_fba, 100, current_date, v_uid);
    RAISE EXCEPTION 'FAIL transfers: oversized transfer allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_INSUFFICIENT:%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, date, created_by)
      VALUES (v_prod, v_main, v_drop, 1, current_date, v_uid);
    RAISE EXCEPTION 'FAIL transfers: transfer to dropship allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_DROPSHIP_LOCATION:%' THEN RAISE; END IF;
  END;

  -- Location guards
  BEGIN
    DELETE FROM stock_locations WHERE id = v_main;
    RAISE EXCEPTION 'FAIL locations: deleting an in-use location allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_LOCATION_IN_USE:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE stock_locations SET is_active = false WHERE id = v_main;
    RAISE EXCEPTION 'FAIL locations: deactivating the default allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_DEFAULT_LOCATION:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE stock_locations SET type = 'dropship' WHERE id = v_main;
    RAISE EXCEPTION 'FAIL locations: switching a stocked location to dropship allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_LOCATION_IN_USE:%' THEN RAISE; END IF;
  END;

  -- set_default_location: dropship rejected, FBA accepted, non-admin forbidden
  BEGIN
    PERFORM set_default_location(v_drop);
    RAISE EXCEPTION 'FAIL rpc: dropship accepted as default location';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_DEFAULT_LOCATION:%' THEN RAISE; END IF;
  END;
  PERFORM set_default_location(v_fba);
  IF (SELECT default_location_id FROM inventory_settings) IS DISTINCT FROM v_fba THEN
    RAISE EXCEPTION 'FAIL rpc: default location not updated';
  END IF;
  UPDATE profiles SET role = 'accountant' WHERE id = v_uid;
  BEGIN
    PERFORM set_default_location(v_main);
    RAISE EXCEPTION 'FAIL rpc: accountant changed the default location';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_FORBIDDEN:%' THEN RAISE; END IF;
  END;
  UPDATE profiles SET role = 'admin' WHERE id = v_uid;
  IF NOT has_function_privilege('authenticated', 'tenant_zz_invtest.set_default_location(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL privileges: authenticated cannot call set_default_location';
  END IF;

  -- Consistency with the legacy counter. Widget history: purchases 5 + 12 + 2 (dropship) + 10,
  -- sales 13 + 2 (dropship); s1 restocked. Legacy current_stock = 14 = lots at stock-holding
  -- locations (the dropship purchase and dropship sale cancel out in the legacy counter).
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots WHERE product_id = v_prod;
  IF v_int IS DISTINCT FROM 14 OR (SELECT current_stock FROM products WHERE id = v_prod) IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FAIL consistency: lots % vs current_stock %', v_int, (SELECT current_stock FROM products WHERE id = v_prod);
  END IF;

  -- Deleting a product keeps its sales' booked COGS and lets its lots/movements/
  -- transfers cascade cleanly (F1: FK cascade nulls sales.product_id, which used
  -- to wipe cogs_amount; and a pending transfer used to raise INV_CONSUMED).
  INSERT INTO products (name, created_by) VALUES ('Doomed2', v_uid) RETURNING id INTO v_ptmp;
  -- default_location_id is now v_fba (set_default_location above), but ebay's
  -- platform default is still Main, so pass location_id explicitly here.
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, location_id)
    VALUES ('Doomed2', v_ptmp, 3, 4, 12, current_date, v_uid, v_main);
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Doomed2', v_ptmp, 2, 30, 60, current_date, v_uid) RETURNING id INTO v_sa;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_sa;
  IF v_num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION 'FAIL delete: Doomed2 sale COGS expected 8.00, got %', v_num;
  END IF;
  INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, date, created_by)
    VALUES (v_ptmp, v_main, v_fba, 1, current_date, v_uid) RETURNING id INTO v_t1;
  DELETE FROM products WHERE id = v_ptmp;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION 'FAIL delete: product delete wiped booked COGS';
  END IF;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE product_id = v_ptmp)
     OR EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_ptmp)
     OR EXISTS (SELECT 1 FROM stock_transfers WHERE product_id = v_ptmp) THEN
    RAISE EXCEPTION 'FAIL delete: ledger rows survived product delete';
  END IF;

  -- ── Section: pre-enable returns + productless sales (Task 11) ──
  -- v_sg is the pre-enable Gadget sale (ebay, no location, qty 2 after the
  -- ignored Task 6 edit). ebay still maps to Main; default location is FBA.
  SELECT coalesce(sum(qty_remaining), 0) INTO v_gq FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main;
  IF v_gq IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL pre-enable: Gadget at Main expected 3, got %', v_gq; END IF;

  -- Returned + restocked: the 2 units come back as a zero-cost opening lot at Main; COGS untouched
  UPDATE sales SET status = 'returned', restock = true WHERE id = v_sg;
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main;
  IF v_int IS DISTINCT FROM v_gq + 2 THEN RAISE EXCEPTION 'FAIL pre-enable: restock expected Gadget at Main %, got %', v_gq + 2, v_int; END IF;
  SELECT count(*) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main AND kind = 'opening';
  IF v_int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL pre-enable: expected 2 Gadget opening lots, got %', v_int; END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_lots
                 WHERE product_id = v_prod2 AND location_id = v_main AND kind = 'opening'
                   AND unit_cost = 0 AND qty_received = 2 AND qty_remaining = 2) THEN
    RAISE EXCEPTION 'FAIL pre-enable: returned units not added as a zero-cost opening lot';
  END IF;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sg) IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'FAIL pre-enable: restock changed cogs_amount';
  END IF;

  -- Restock undone: FIFO takes 2 zero-cost opening units back → COGS 0.00
  UPDATE sales SET status = 'delivered', restock = false WHERE id = v_sg;
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main;
  IF v_int IS DISTINCT FROM v_gq THEN RAISE EXCEPTION 'FAIL pre-enable: un-restock expected Gadget at Main %, got %', v_gq, v_int; END IF;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sg) IS DISTINCT FROM 0.00 THEN
    RAISE EXCEPTION 'FAIL pre-enable: un-restock COGS expected 0.00';
  END IF;

  -- A non-flip pre-enable edit is still ignored
  UPDATE sales SET quantity = 3, total_amount = 27 WHERE id = v_sg;
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main;
  IF v_int IS DISTINCT FROM v_gq THEN RAISE EXCEPTION 'FAIL pre-enable: non-flip edit moved Gadget at Main to %', v_int; END IF;

  -- Restocked again: reverts the un-restock's movements instead of adding a second opening lot
  UPDATE sales SET status = 'returned', restock = true WHERE id = v_sg;
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main;
  IF v_int IS DISTINCT FROM v_gq + 2 THEN RAISE EXCEPTION 'FAIL pre-enable: re-restock expected Gadget at Main %, got %', v_gq + 2, v_int; END IF;
  SELECT count(*) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main AND kind = 'opening';
  IF v_int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL pre-enable: re-restock added another opening lot (% lots)', v_int; END IF;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_sg) THEN
    RAISE EXCEPTION 'FAIL pre-enable: re-restock left sale movements behind';
  END IF;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sg) IS DISTINCT FROM 0.00 THEN
    RAISE EXCEPTION 'FAIL pre-enable: re-restock COGS expected 0.00';
  END IF;

  -- Deleting the restocked return leaves the lots alone (legacy current_stock doesn't move either)
  DELETE FROM sales WHERE id = v_sg;
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots
    WHERE product_id = v_prod2 AND location_id = v_main;
  IF v_int IS DISTINCT FROM v_gq + 2 THEN RAISE EXCEPTION 'FAIL pre-enable: deleting the restocked return moved Gadget at Main to %', v_int; END IF;

  -- Orphaned sale (Doomed2, product deleted above) keeps its booked COGS on a later edit
  UPDATE sales SET quantity = 1, total_amount = 10 WHERE id = v_sa;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION 'FAIL productless: edit wiped booked COGS';
  END IF;

  RAISE EXCEPTION 'INV_TESTS_PASSED';
END
$test$;
