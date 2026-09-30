-- ============================================================
-- 055 — Section permissions (per-user section × level access)
--
-- Defines public.install_section_permissions(schema_name), which, for one
-- tenant schema:
--   1. creates user_section_access (per-user EXCEPTIONS only) + its RLS;
--   2. creates role_section_default / section_level_allowed /
--      section_max_level / current_user_access / get_my_access /
--      notification_section;
--   3. rewrites every governed table's RLS policies (drops ALL existing
--      policies on those tables first, so no stale permissive policy can
--      survive and widen access);
--   4. wraps the Home/Analytics totals RPCs: <name> → <name>__impl
--      (SECURITY DEFINER, EXECUTE revoked) + a same-signature guarded
--      wrapper commented 'section-permissions guard'. Edit totals logic in
--      <name>__impl from now on; a later CREATE OR REPLACE of <name> is
--      re-wrapped the next time this installer runs.
-- Defaults reproduce the behaviour before this migration exactly.
-- Idempotent. Skips tables a tenant does not have (to_regclass).
-- Called by: this migration (all tenants), provision_tenant_schema() (005)
-- and install_advanced_inventory() (047), both guarded by to_regprocedure.
-- See docs/superpowers/specs/2026-09-30-section-permissions-design.md
-- ============================================================

CREATE OR REPLACE FUNCTION public.install_section_permissions(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $install$
DECLARE
  s   text := schema_name;
  t   text;
  pol record;
  fn  record;
  target regprocedure;
BEGIN
  -- ── 1. exceptions table ─────────────────────────────────────────────
  EXECUTE format($q$
    CREATE TABLE IF NOT EXISTS %1$I.user_section_access (
      user_id    uuid NOT NULL REFERENCES %1$I.profiles(id) ON DELETE CASCADE,
      section    text NOT NULL CHECK (section IN ('overview','analytics','orders','expenses','purchases',
                                                  'inventory','payouts','integrations','listings','messages',
                                                  'audit_logs','settings')),
      level      smallint NOT NULL CHECK (level BETWEEN 0 AND 3),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid,
      PRIMARY KEY (user_id, section)
    )$q$, s);
  EXECUTE format('ALTER TABLE %1$I.user_section_access ENABLE ROW LEVEL SECURITY', s);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.user_section_access TO authenticated', s);
  EXECUTE format('REVOKE ALL ON %1$I.user_section_access FROM anon', s);

  -- ── 2. functions ────────────────────────────────────────────────────
  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.section_level_allowed(p_section text, p_level smallint)
    RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
      SELECT CASE
        WHEN p_section IN ('overview','analytics','audit_logs') THEN p_level IN (0, 1)
        WHEN p_section IN ('integrations','listings','messages') THEN p_level IN (0, 2)
        WHEN p_section = 'settings' THEN p_level IN (0, 1, 2)
        WHEN p_section IN ('orders','expenses','purchases','inventory','payouts') THEN p_level BETWEEN 0 AND 3
        ELSE false
      END
    $f$$q$, s);

  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.section_max_level(p_section text)
    RETURNS smallint LANGUAGE sql IMMUTABLE AS $f$
      SELECT (CASE
        WHEN p_section IN ('overview','analytics','audit_logs') THEN 1
        WHEN p_section IN ('integrations','listings','messages','settings') THEN 2
        WHEN p_section IN ('orders','expenses','purchases','inventory','payouts') THEN 3
        ELSE 0
      END)::smallint
    $f$$q$, s);

  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.role_section_default(p_role text, p_section text)
    RETURNS smallint LANGUAGE sql IMMUTABLE SET search_path = %1$I AS $f$
      SELECT (CASE
        WHEN p_role IN ('super_admin', 'admin') THEN section_max_level(p_section)
        WHEN p_role = 'accountant' THEN CASE p_section
          WHEN 'overview' THEN 1 WHEN 'analytics' THEN 1
          WHEN 'orders' THEN 2 WHEN 'expenses' THEN 2 WHEN 'purchases' THEN 2 WHEN 'inventory' THEN 2
          WHEN 'payouts' THEN 1 WHEN 'settings' THEN 1
          ELSE 0 END
        ELSE 0
      END)::smallint
    $f$$q$, s);

  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.current_user_access(p_section text)
    RETURNS smallint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = %1$I AS $f$
      SELECT COALESCE((
        SELECT CASE
          WHEN p.status = 'deactivated' THEN 0::smallint
          WHEN p.role = 'super_admin' THEN section_max_level(p_section)
          ELSE COALESCE(
            (SELECT a.level FROM user_section_access a WHERE a.user_id = p.id AND a.section = p_section),
            role_section_default(p.role, p_section))
        END
        FROM profiles p WHERE p.id = auth.uid() AND %1$I.is_tenant_member()
      ), 0::smallint)
    $f$$q$, s);

  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.get_my_access()
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = %1$I AS $f$
      SELECT jsonb_object_agg(sec, current_user_access(sec))
      FROM unnest(ARRAY['overview','analytics','orders','expenses','purchases','inventory','payouts',
                        'integrations','listings','messages','audit_logs','settings']) AS sec
    $f$$q$, s);

  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.notification_section(p_type text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $f$
      SELECT CASE p_type
        WHEN 'sale.created' THEN 'orders'
        WHEN 'purchase.created' THEN 'purchases'
        WHEN 'message.received' THEN 'messages'
        ELSE NULL END
    $f$$q$, s);

  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.current_user_access(text) FROM PUBLIC, anon', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.current_user_access(text) TO authenticated', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.current_user_access(text) TO service_role', s);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.get_my_access() FROM PUBLIC, anon', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_my_access() TO authenticated', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_my_access() TO service_role', s);

  -- Validity trigger: allowed level for the section; never an exception for a super_admin.
  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.user_section_access_validate()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I AS $f$
    BEGIN
      IF NOT section_level_allowed(NEW.section, NEW.level) THEN
        RAISE EXCEPTION 'SECTION_LEVEL_NOT_ALLOWED: %% level %%', NEW.section, NEW.level;
      END IF;
      IF (SELECT role FROM profiles WHERE id = NEW.user_id) = 'super_admin' THEN
        RAISE EXCEPTION 'SECTION_ACCESS_SUPER_ADMIN';
      END IF;
      NEW.updated_at := now();
      NEW.updated_by := auth.uid();
      RETURN NEW;
    END
    $f$$q$, s);
  EXECUTE format('DROP TRIGGER IF EXISTS user_section_access_validate ON %1$I.user_section_access', s);
  EXECUTE format('CREATE TRIGGER user_section_access_validate BEFORE INSERT OR UPDATE ON %1$I.user_section_access FOR EACH ROW EXECUTE FUNCTION %1$I.user_section_access_validate()', s);

  -- Role change: drop exceptions that now equal the new role's default (all of them for super_admin).
  EXECUTE format($q$
    CREATE OR REPLACE FUNCTION %1$I.section_access_cleanup_on_role_change()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I AS $f$
    BEGIN
      DELETE FROM user_section_access a
      WHERE a.user_id = NEW.id
        AND (NEW.role = 'super_admin' OR a.level = role_section_default(NEW.role, a.section));
      RETURN NULL;
    END
    $f$$q$, s);
  EXECUTE format('DROP TRIGGER IF EXISTS section_access_cleanup_on_role_change ON %1$I.profiles', s);
  EXECUTE format('CREATE TRIGGER section_access_cleanup_on_role_change AFTER UPDATE OF role ON %1$I.profiles FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role) EXECUTE FUNCTION %1$I.section_access_cleanup_on_role_change()', s);

  -- ── 3. policies ─────────────────────────────────────────────────────
  -- Drop EVERY existing policy on the governed tables, then recreate.
  FOREACH t IN ARRAY ARRAY['user_section_access','sales','shipments','expenses','purchases','products',
                           'platform_payouts','audit_logs','company_profile','platform_connections',
                           'ebay_listing_drafts','ebay_messages','stock_locations','platform_location_defaults',
                           'inventory_settings','stock_lots','stock_movements','stock_transfers','notifications']
  LOOP
    IF to_regclass(format('%I.%I', s, t)) IS NULL THEN CONTINUE; END IF;
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = s AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, s, t);
    END LOOP;
  END LOOP;

  -- user_section_access: own rows or super_admin read; super_admin writes.
  EXECUTE format($q$CREATE POLICY usa_select ON %1$I.user_section_access FOR SELECT
    USING (%1$I.is_tenant_member() AND (user_id = auth.uid() OR %1$I.current_user_role() = 'super_admin'))$q$, s);
  EXECUTE format($q$CREATE POLICY usa_insert ON %1$I.user_section_access FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() = 'super_admin')$q$, s);
  EXECUTE format($q$CREATE POLICY usa_update ON %1$I.user_section_access FOR UPDATE
    USING (%1$I.is_tenant_member() AND %1$I.current_user_role() = 'super_admin')
    WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() = 'super_admin')$q$, s);
  EXECUTE format($q$CREATE POLICY usa_delete ON %1$I.user_section_access FOR DELETE
    USING (%1$I.is_tenant_member() AND %1$I.current_user_role() = 'super_admin')$q$, s);

  -- Standard 4-command tables: (table, section, select, insert, update, delete) minimum levels.
  FOR fn IN SELECT * FROM (VALUES
      ('sales',            'orders',    1, 2, 2, 3),
      ('expenses',         'expenses',  1, 2, 2, 3),
      ('purchases',        'purchases', 1, 2, 2, 3),
      ('products',         'inventory', 1, 2, 2, 3),
      ('platform_connections', 'integrations', 2, 2, 2, 2),
      ('ebay_listing_drafts',  'listings',     2, 2, 2, 2),
      ('ebay_messages',        'messages',     2, 2, 2, 2),
      ('stock_locations',            'inventory', 1, 3, 3, 3),
      ('platform_location_defaults', 'inventory', 1, 3, 3, 3)
    ) v(tbl, sec, lsel, lins, lupd, ldel)
  LOOP
    IF to_regclass(format('%I.%I', s, fn.tbl)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR SELECT
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access(%4$L)) >= %5$s)$q$,
      s, fn.tbl || '_select', fn.tbl, fn.sec, fn.lsel);
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR INSERT
      WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access(%4$L)) >= %5$s)$q$,
      s, fn.tbl || '_insert', fn.tbl, fn.sec, fn.lins);
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR UPDATE
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access(%4$L)) >= %5$s)
      WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access(%4$L)) >= %5$s)$q$,
      s, fn.tbl || '_update', fn.tbl, fn.sec, fn.lupd);
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR DELETE
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access(%4$L)) >= %5$s)$q$,
      s, fn.tbl || '_delete', fn.tbl, fn.sec, fn.ldel);
  END LOOP;

  -- Read-only (trigger-written) inventory tables.
  FOREACH t IN ARRAY ARRAY['inventory_settings','stock_lots','stock_movements'] LOOP
    IF to_regclass(format('%I.%I', s, t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR SELECT
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('inventory')) >= 1)$q$, s, t || '_select', t);
  END LOOP;

  IF to_regclass(format('%I.stock_transfers', s)) IS NOT NULL THEN
    EXECUTE format($q$CREATE POLICY stock_transfers_select ON %1$I.stock_transfers FOR SELECT
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('inventory')) >= 1)$q$, s);
    EXECUTE format($q$CREATE POLICY stock_transfers_insert ON %1$I.stock_transfers FOR INSERT
      WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('inventory')) >= 2 AND created_by = auth.uid())$q$, s);
    EXECUTE format($q$CREATE POLICY stock_transfers_delete ON %1$I.stock_transfers FOR DELETE
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('inventory')) >= 2)$q$, s);
  END IF;

  IF to_regclass(format('%I.shipments', s)) IS NOT NULL THEN
    EXECUTE format($q$CREATE POLICY shipments_select ON %1$I.shipments FOR SELECT
      USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('orders')) >= 1)$q$, s);
    EXECUTE format($q$CREATE POLICY shipments_insert ON %1$I.shipments FOR INSERT
      WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('orders')) >= 3)$q$, s);
  END IF;

  EXECUTE format($q$CREATE POLICY platform_payouts_select ON %1$I.platform_payouts FOR SELECT
    USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('payouts')) >= 1)$q$, s);
  EXECUTE format($q$CREATE POLICY platform_payouts_insert ON %1$I.platform_payouts FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('payouts')) >= 2)$q$, s);
  EXECUTE format($q$CREATE POLICY platform_payouts_delete ON %1$I.platform_payouts FOR DELETE
    USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('payouts')) >= 3)$q$, s);

  EXECUTE format($q$CREATE POLICY audit_logs_select ON %1$I.audit_logs FOR SELECT
    USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('audit_logs')) >= 1)$q$, s);
  EXECUTE format($q$CREATE POLICY audit_logs_insert ON %1$I.audit_logs FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND auth.role() = 'authenticated')$q$, s);

  EXECUTE format($q$CREATE POLICY company_profile_select ON %1$I.company_profile FOR SELECT
    USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated')$q$, s);
  EXECUTE format($q$CREATE POLICY company_profile_insert ON %1$I.company_profile FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('settings')) >= 2)$q$, s);
  EXECUTE format($q$CREATE POLICY company_profile_update ON %1$I.company_profile FOR UPDATE
    USING (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('settings')) >= 2)
    WITH CHECK (%1$I.is_tenant_member() AND (SELECT %1$I.current_user_access('settings')) >= 2)$q$, s);

  IF to_regclass(format('%I.notifications', s)) IS NOT NULL THEN
    EXECUTE format($q$CREATE POLICY notifications_select ON %1$I.notifications FOR SELECT
      USING (%1$I.is_tenant_member()
             AND %1$I.current_user_role() = ANY(visible_to_roles)
             AND (%1$I.notification_section(type) IS NULL
                  OR %1$I.current_user_access(%1$I.notification_section(type)) >= 1))$q$, s);
  END IF;

  -- ── 4. totals RPCs: definer + guard, bodies untouched ───────────────
  FOR fn IN SELECT * FROM (VALUES
      ('get_sales_overview',      'date, date, text', 'p_from date, p_to date, p_currency text', 'p_from, p_to, p_currency', 'jsonb'),
      ('get_expenses_overview',   'date, date, text', 'p_from date, p_to date, p_currency text', 'p_from, p_to, p_currency', 'jsonb'),
      ('get_purchases_overview',  'date, date, text', 'p_from date, p_to date, p_currency text', 'p_from, p_to, p_currency', 'jsonb'),
      ('get_payouts_overview',    'date, date, text', 'p_from date, p_to date, p_currency text', 'p_from, p_to, p_currency', 'jsonb'),
      ('get_overview_timeseries', 'date, date, text', 'p_from date, p_to date, p_currency text', 'p_from, p_to, p_currency', 'jsonb'),
      ('get_sales_by_marketplace', 'date, date, text', 'p_from date, p_to date, p_currency text', 'p_from, p_to, p_currency',
         'TABLE (marketplace text, order_count int, revenue numeric, vat numeric, vat_base numeric)'),
      ('get_platform_running_balance', 'date, text', 'p_to date, p_currency text', 'p_to, p_currency',
         'TABLE (platform text, earned numeric, expenses numeric, transferred numeric)')
    ) v(name, types, params, args, rettype)
  LOOP
    target := to_regprocedure(format('%I.%I(%s)', s, fn.name, fn.types));
    IF target IS NULL THEN CONTINUE; END IF;
    -- Already wrapped? Check the BODY, not the comment: a later
    -- CREATE OR REPLACE of <name> keeps the comment but replaces the body.
    IF position(fn.name || '__impl' IN (SELECT prosrc FROM pg_proc WHERE oid = target)) > 0 THEN CONTINUE; END IF;

    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s)', s, fn.name || '__impl', fn.types);
    EXECUTE format('ALTER FUNCTION %I.%I(%s) RENAME TO %I', s, fn.name, fn.types, fn.name || '__impl');
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SECURITY DEFINER SET search_path TO %I', s, fn.name || '__impl', fn.types, s);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated', s, fn.name || '__impl', fn.types);
    -- Integration tests call <name>__impl with the service role (no auth.uid()).
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', s, fn.name || '__impl', fn.types);

    IF fn.rettype = 'jsonb' THEN
      EXECUTE format($q$
        CREATE FUNCTION %1$I.%2$I(%3$s) RETURNS jsonb
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = %1$I AS $f$
          SELECT CASE WHEN greatest(current_user_access('overview'), current_user_access('analytics')) >= 1
                      THEN %4$I(%5$s) END
        $f$$q$, s, fn.name, fn.params, fn.name || '__impl', fn.args);
    ELSE
      EXECUTE format($q$
        CREATE FUNCTION %1$I.%2$I(%3$s) RETURNS %6$s
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = %1$I AS $f$
          SELECT * FROM %4$I(%5$s)
          WHERE greatest(current_user_access('overview'), current_user_access('analytics')) >= 1
        $f$$q$, s, fn.name, fn.params, fn.name || '__impl', fn.args, fn.rettype);
    END IF;
    EXECUTE format('COMMENT ON FUNCTION %I.%I(%s) IS %L', s, fn.name, fn.types, 'section-permissions guard');
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon', s, fn.name, fn.types);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated', s, fn.name, fn.types);
    -- Integration tests call the guarded wrapper too (Task 2): service role
    -- gets NULL/empty from the guard, not a permission-denied error.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', s, fn.name, fn.types);
  END LOOP;
END
$install$;

COMMENT ON FUNCTION public.install_section_permissions(text) IS
  'Per-tenant section permissions (055). Idempotent; called by 055, provision_tenant_schema() and install_advanced_inventory().';
REVOKE ALL ON FUNCTION public.install_section_permissions(text) FROM PUBLIC, anon, authenticated;

SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_section_permissions('{{schema}}');
$$);
