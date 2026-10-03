# Section Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user access control — a section × level grid (None/View/Edit/Delete) that the tenant's super_admin edits per user, with role defaults, enforced in Postgres RLS, the route guard and the UI.

**Architecture:** One SQL installer (`public.install_section_permissions(schema)`, migration 055) creates a per-tenant exceptions table, `role_section_default` / `current_user_access` / `get_my_access` functions, rewrites the RLS policies of every governed table, and wraps the Home/Analytics totals RPCs in a definer guard. A pure TypeScript mirror (`src/lib/permissions/sections.ts`) drives the Redux-hydrated access map, `proxy.ts`, the sidebar, buttons and server guards. A new Permissions page edits the exceptions.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before touching routing), Supabase Postgres (RLS, plpgsql), Redux Toolkit, Jest.

**Spec:** `docs/superpowers/specs/2026-09-30-section-permissions-design.md`

## Global Constraints

- Branch `feat/section-permissions` (already checked out). Never commit to `main`.
- Section keys (exact, 12): `overview`, `analytics`, `orders`, `expenses`, `purchases`, `inventory`, `payouts`, `integrations`, `listings`, `messages`, `audit_logs`, `settings`.
- Levels: `0` None · `1` View · `2` Edit · `3` Delete (cumulative).
- Allowed levels: `overview`/`analytics`/`audit_logs` → {0,1}; `integrations`/`listings`/`messages` → {0,2}; `settings` → {0,1,2}; `orders`/`expenses`/`purchases`/`inventory`/`payouts` → {0,1,2,3}.
- Role defaults: `super_admin` = max for every section (locked); `admin` = max for every section; `accountant` = overview 1, analytics 1, orders 2, expenses 2, purchases 2, inventory 2, payouts 1, integrations 0, listings 0, messages 0, audit_logs 0, settings 1.
- Wrapper comment (exact, informational): `section-permissions guard`. Impl suffix (exact): `__impl`. "Already wrapped" is detected from the function body referencing `<name>__impl`, never from the comment.
- Only super_admin manages permissions/users. Dropshipping and Planner are not sections; Support is always available.
- Plan ceiling (app only): `integrations` requires `hasPlatformIntegrations(plan)`; `listings` and `messages` require `hasMessagingAndListings(plan)`.
- Never query `public.*` from app code; never hardcode a tenant schema name. The installer SQL is migration code (allowed).
- Run focused tests only (`npx jest <path>`); do not run `tsc`/`lint` by hand — `git commit` runs them (`.husky/pre-commit`). Fix and re-run the same commit if it fails.
- Do not start the dev server. Do not execute SQL against any database — the user applies migrations; the controller verifies read-only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Docs (`CLAUDE.md`/`SKILL.md`) go in the same commit as the code they describe.
- Every mutation fires a `useToast()` on success and failure; forms follow AGENTS.md "Form conventions".

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `supabase/migrations/055_section_permissions.sql` | create | `public.install_section_permissions(schema)` + run on all tenants |
| `supabase/migrations/047_advanced_inventory.sql` | modify | installer calls section installer at its end |
| `supabase/migrations/005_tenant_provisioning.sql` | modify | provisioning calls section installer last |
| `src/lib/permissions/sections.ts` (+ test) | create | sections, levels, defaults, `effectiveAccess`, path mapping |
| `src/lib/permissions/requireSectionAccess.ts` | create | server route guard |
| `src/lib/permissions/sectionPermissions.integration.test.ts` | create | live SQL checks (run after 055 applied) |
| `src/store/slices/currentUserSlice.ts` (+ test) | modify | `access` state |
| `src/store/useAccess.ts` | create | client hook |
| `src/app/dashboard/layout.tsx`, `src/store/StoreProvider.tsx` | modify | hydrate access |
| `src/proxy.ts` | modify | section route guard |
| `src/components/layout/Sidebar.tsx` | modify | hide None sections |
| feature pages/modals (Task 5 list) | modify | gate buttons |
| `src/lib/integrations/authGuard.ts`, `src/lib/ai/authGuard.ts`, 8 listings/messages routes, 2 shipping routes | modify | section guard |
| `src/app/dashboard/users/_lib/accessDiff.ts` (+ test) | create | grid diff |
| `src/app/dashboard/users/[id]/permissions/page.tsx` | create | Permissions screen |
| `src/app/dashboard/users/page.tsx` | modify | Permissions link + badge |
| `src/app/dashboard/users/_components/PermissionsModal.tsx`, `src/lib/utils/permissions.ts` (+ test) | delete | retired |

---

### Task 1: SQL installer — migration 055

**Files:**
- Create: `supabase/migrations/055_section_permissions.sql`
- Modify: `supabase/migrations/047_advanced_inventory.sql` (end of `install_advanced_inventory` body, just before its final `END;`)
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (after the guarded `install_advanced_inventory` call near the end)
- Create: `src/lib/permissions/sectionPermissions.integration.test.ts`
- Docs: `supabase/SKILL.md` (file-map row + gotcha), `supabase/CLAUDE.md` (entry)

**Interfaces:**
- Produces (per tenant schema): table `user_section_access(user_id, section, level, updated_at, updated_by)`; functions `section_level_allowed(text, smallint) → boolean`, `section_max_level(text) → smallint`, `role_section_default(text, text) → smallint`, `current_user_access(text) → smallint`, `get_my_access() → jsonb`, `notification_section(text) → text`; trigger function `section_access_cleanup_on_role_change()`; the 7 totals RPCs keep their names/signatures but become guarded wrappers over `<name>__impl`.

- [ ] **Step 1: Write `supabase/migrations/055_section_permissions.sql`** (exactly):

```sql
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
        FROM profiles p WHERE p.id = auth.uid()
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
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.get_my_access() FROM PUBLIC, anon', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_my_access() TO authenticated', s);

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
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access(%4$L) >= %5$s)$q$,
      s, fn.tbl || '_select', fn.tbl, fn.sec, fn.lsel);
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR INSERT
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access(%4$L) >= %5$s)$q$,
      s, fn.tbl || '_insert', fn.tbl, fn.sec, fn.lins);
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR UPDATE
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access(%4$L) >= %5$s)
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access(%4$L) >= %5$s)$q$,
      s, fn.tbl || '_update', fn.tbl, fn.sec, fn.lupd);
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR DELETE
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access(%4$L) >= %5$s)$q$,
      s, fn.tbl || '_delete', fn.tbl, fn.sec, fn.ldel);
  END LOOP;

  -- Read-only (trigger-written) inventory tables.
  FOREACH t IN ARRAY ARRAY['inventory_settings','stock_lots','stock_movements'] LOOP
    IF to_regclass(format('%I.%I', s, t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format($q$CREATE POLICY %2$I ON %1$I.%3$I FOR SELECT
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access('inventory') >= 1)$q$, s, t || '_select', t);
  END LOOP;

  IF to_regclass(format('%I.stock_transfers', s)) IS NOT NULL THEN
    EXECUTE format($q$CREATE POLICY stock_transfers_select ON %1$I.stock_transfers FOR SELECT
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access('inventory') >= 1)$q$, s);
    EXECUTE format($q$CREATE POLICY stock_transfers_insert ON %1$I.stock_transfers FOR INSERT
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access('inventory') >= 2 AND created_by = auth.uid())$q$, s);
    EXECUTE format($q$CREATE POLICY stock_transfers_delete ON %1$I.stock_transfers FOR DELETE
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access('inventory') >= 2)$q$, s);
  END IF;

  IF to_regclass(format('%I.shipments', s)) IS NOT NULL THEN
    EXECUTE format($q$CREATE POLICY shipments_select ON %1$I.shipments FOR SELECT
      USING (%1$I.is_tenant_member() AND %1$I.current_user_access('orders') >= 1)$q$, s);
    EXECUTE format($q$CREATE POLICY shipments_insert ON %1$I.shipments FOR INSERT
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access('orders') >= 3)$q$, s);
  END IF;

  EXECUTE format($q$CREATE POLICY platform_payouts_select ON %1$I.platform_payouts FOR SELECT
    USING (%1$I.is_tenant_member() AND %1$I.current_user_access('payouts') >= 1)$q$, s);
  EXECUTE format($q$CREATE POLICY platform_payouts_insert ON %1$I.platform_payouts FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access('payouts') >= 2)$q$, s);
  EXECUTE format($q$CREATE POLICY platform_payouts_delete ON %1$I.platform_payouts FOR DELETE
    USING (%1$I.is_tenant_member() AND %1$I.current_user_access('payouts') >= 3)$q$, s);

  EXECUTE format($q$CREATE POLICY audit_logs_select ON %1$I.audit_logs FOR SELECT
    USING (%1$I.is_tenant_member() AND %1$I.current_user_access('audit_logs') >= 1)$q$, s);
  EXECUTE format($q$CREATE POLICY audit_logs_insert ON %1$I.audit_logs FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND auth.role() = 'authenticated')$q$, s);

  EXECUTE format($q$CREATE POLICY company_profile_select ON %1$I.company_profile FOR SELECT
    USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated')$q$, s);
  EXECUTE format($q$CREATE POLICY company_profile_insert ON %1$I.company_profile FOR INSERT
    WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access('settings') >= 2)$q$, s);
  EXECUTE format($q$CREATE POLICY company_profile_update ON %1$I.company_profile FOR UPDATE
    USING (%1$I.is_tenant_member() AND %1$I.current_user_access('settings') >= 2)
    WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_access('settings') >= 2)$q$, s);

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
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SECURITY DEFINER', s, fn.name || '__impl', fn.types);
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
  END LOOP;
END
$install$;

COMMENT ON FUNCTION public.install_section_permissions(text) IS
  'Per-tenant section permissions (055). Idempotent; called by 055, provision_tenant_schema() and install_advanced_inventory().';
REVOKE ALL ON FUNCTION public.install_section_permissions(text) FROM PUBLIC, anon, authenticated;

SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_section_permissions('{{schema}}');
$$);
```

Note: every function body above passes through `format()`, so a literal percent sign must be written `%%` (the `RAISE` placeholders are). Nothing in this file is copied into 005.

- [ ] **Step 2: Hook the installer into 047.** In `supabase/migrations/047_advanced_inventory.sql`, find the last statement inside `public.install_advanced_inventory` (the `$…$` body ending in `END;` before `COMMENT ON FUNCTION public.install_advanced_inventory`). Immediately before that final `END;` add:

```sql
  -- Section permissions (055) own the stock_* RLS policies; this installer
  -- re-creates its own policies above every time it runs, so re-apply the
  -- section rules last or they would be silently reverted.
  IF to_regprocedure('public.install_section_permissions(text)') IS NOT NULL THEN
    PERFORM public.install_section_permissions(schema_name);
  END IF;
```

- [ ] **Step 3: Hook the installer into 005.** In `supabase/migrations/005_tenant_provisioning.sql`, directly after:

```sql
  IF to_regprocedure('public.install_advanced_inventory(text)') IS NOT NULL THEN
    PERFORM public.install_advanced_inventory(schema_name);
  END IF;
```
add:

```sql

  -- ── 10. Section permissions (055) ─────────────────────────
  -- Must run after every table/function above exists: it rewrites their
  -- RLS policies and wraps the totals RPCs. Guarded like the call above.
  IF to_regprocedure('public.install_section_permissions(text)') IS NOT NULL THEN
    PERFORM public.install_section_permissions(schema_name);
  END IF;
```
(No literal percent sign introduced — `005`'s `format()` rule is unaffected since this is plain plpgsql.)

- [ ] **Step 4: Write the live integration test** `src/lib/permissions/sectionPermissions.integration.test.ts`. Model its setup on `src/app/dashboard/_lib/overviewRpc.integration.test.ts` (same `SCHEMA`, `createServiceClientForTenant`, profile lookup, cleanup). It must check, using the service client (SQL-level, not per-user JWT — per-user RLS assertions are covered by Step 6's manual script):

```ts
// Requires 055 applied to the test tenant.
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { ROLE_DEFAULTS, SECTION_KEYS } from "./sections";

const SCHEMA = "tenant_boughtopia";

describe("055 section permissions (live)", () => {
  const client = createServiceClientForTenant(SCHEMA);

  it("role_section_default matches ROLE_DEFAULTS for every role × section", async () => {
    for (const role of ["super_admin", "admin", "accountant"] as const) {
      for (const section of SECTION_KEYS) {
        const { data, error } = await client.rpc("role_section_default", { p_role: role, p_section: section });
        if (error) throw error;
        expect({ role, section, level: data }).toEqual({ role, section, level: ROLE_DEFAULTS[role][section] });
      }
    }
  });

  it("wraps the 7 totals RPCs with the guard marker", async () => {
    const { data, error } = await client.rpc("get_my_access"); // service role: no auth.uid() → all 0
    if (error) throw error;
    expect(Object.values(data as Record<string, number>).every((v) => v === 0)).toBe(true);
    const { data: ov } = await client.rpc("get_sales_overview", { p_from: null, p_to: null, p_currency: "EUR" });
    expect(ov).toBeNull(); // guard: no user → access 0 → NULL
  });
});
```
(`ROLE_DEFAULTS`/`SECTION_KEYS` come from Task 2 — write this file now; it is excluded from `npx jest` by `jest.config.ts` and will compile once Task 2 lands. If `role_section_default` isn't exposed via PostgREST for the service role, call it through `client.rpc` anyway — service role bypasses grants.)

- [ ] **Step 4b: Point the existing live tests at the impls.** In `src/app/dashboard/_lib/overviewRpc.integration.test.ts`, `src/app/dashboard/_lib/overviewTimeseries.integration.test.ts` and any other `*.integration.test.ts` calling one of the 7 totals RPCs (`grep -rln "get_sales_overview\|get_expenses_overview\|get_purchases_overview\|get_payouts_overview\|get_overview_timeseries\|get_sales_by_marketplace\|get_platform_running_balance" src --include=*.integration.test.ts`), change the RPC name to `<name>__impl` — the service role has no `auth.uid()`, so the guarded wrapper returns NULL for it. Add one comment at the top of each file: `// Totals RPCs are guarded wrappers since 055; tests call <name>__impl (service role, no auth.uid()).`

- [ ] **Step 5: Docs.** `supabase/SKILL.md` file-map row after 054:

```md
| `migrations/055_section_permissions.sql` | all `tenant_%` schemas | ⏳ **pending** — defines `public.install_section_permissions(schema)` and runs it on every tenant: `user_section_access` (per-user exceptions), `role_section_default`/`current_user_access`/`get_my_access`/`notification_section`, rewrites RLS on sales/shipments/expenses/purchases/products/platform_payouts/audit_logs/company_profile/platform_connections/ebay_listing_drafts/ebay_messages/stock_*/inventory_settings/platform_location_defaults/notifications (drops ALL their policies first), wraps the 7 totals RPCs as `<name>` → `<name>__impl`. **Apply 055, then re-apply 047 and 005** (both now call the installer last). Defaults = previous behaviour. |
```
and a gotcha paragraph: "**Totals RPCs are wrapped (055).** Edit `<name>__impl`, not `<name>`. A migration that `CREATE OR REPLACE`s `<name>` replaces the guarded wrapper with an unguarded invoker function — re-run `SELECT public.install_section_permissions('<schema>')` via `run_on_all_tenant_schemas` in the same migration. **Any new tenant table needs a policy block in `install_section_permissions`**, or it keeps whatever policy its own migration created." Add a matching `supabase/CLAUDE.md` entry.

- [ ] **Step 6: Commit** (no unit tests run in this task; SQL is verified live after the user applies it):

```bash
git add supabase/migrations/055_section_permissions.sql supabase/migrations/047_advanced_inventory.sql supabase/migrations/005_tenant_provisioning.sql src/lib/permissions/sectionPermissions.integration.test.ts src/app/dashboard/_lib/*.integration.test.ts supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(db): 055 section permissions installer (exceptions table, access fn, RLS rewrite, guarded totals)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If the pre-commit tsc fails because `./sections` doesn't exist yet, move Step 4's file into Task 2's commit instead and note it in the report.

**Checkpoint (controller):** stop and ask the user to apply 055, re-apply 047 and 005. Then verify read-only: (a) `get_my_access` exists in all 5 schemas; (b) every governed table's policies reference `current_user_access` (query `pg_policies.qual`); (c) each of the 7 totals functions' body (`prosrc`) references its `__impl` twin, and the twin exists; (d) as a sanity check, the live app still loads (user confirms Home shows the same numbers).

---

### Task 2: `sections.ts` — pure access model

**Files:**
- Create: `src/lib/permissions/sections.ts`
- Test: `src/lib/permissions/sections.test.ts`

**Interfaces:**
- Produces:
  - `type Section` (12 keys), `const SECTION_KEYS: Section[]`, `type AccessLevel = 0 | 1 | 2 | 3`, `type AccessMap = Record<Section, AccessLevel>`
  - `const LEVEL_LABELS: Record<AccessLevel, string>` = `{0:"None",1:"View",2:"Edit",3:"Delete"}`
  - `interface SectionDef { key: Section; label: string; levels: AccessLevel[]; routes: string[]; description: string }`, `const SECTIONS: SectionDef[]`
  - `const ROLE_DEFAULTS: Record<UserRole, AccessMap>`
  - `maxLevel(section: Section): AccessLevel`
  - `planAllows(section: Section, plan: TenantPlan | null): boolean`
  - `applyPlanCeiling(access: AccessMap, plan: TenantPlan | null): AccessMap`
  - `effectiveAccess(role: UserRole, exceptions: Partial<AccessMap>, plan: TenantPlan | null): AccessMap`
  - `parseAccessMap(raw: unknown, fallbackRole: UserRole): AccessMap` (validates RPC JSON; falls back to role defaults per key)
  - `sectionForPath(pathname: string): Section | "users" | null`
  - `can(access: AccessMap, section: Section, min: AccessLevel): boolean`
  - `firstAccessiblePath(access: AccessMap): string` (first viewable section's route in `SECTIONS` order; `/dashboard/support` if none)

- [ ] **Step 1: Write the failing test** `src/lib/permissions/sections.test.ts`:

```ts
import {
  SECTIONS, SECTION_KEYS, ROLE_DEFAULTS, maxLevel, planAllows, applyPlanCeiling,
  effectiveAccess, parseAccessMap, sectionForPath, can, firstAccessiblePath, type AccessMap,
} from "./sections";

const NONE: AccessMap = Object.fromEntries(SECTION_KEYS.map((k) => [k, 0])) as AccessMap;

describe("sections model", () => {
  it("has the 12 sections in grid order", () => {
    expect(SECTION_KEYS).toEqual([
      "overview", "analytics", "orders", "expenses", "purchases", "inventory",
      "payouts", "integrations", "listings", "messages", "audit_logs", "settings",
    ]);
    expect(SECTIONS.map((s) => s.key)).toEqual(SECTION_KEYS);
  });

  it("allowed levels per section", () => {
    const levels = Object.fromEntries(SECTIONS.map((s) => [s.key, s.levels]));
    expect(levels.overview).toEqual([0, 1]);
    expect(levels.audit_logs).toEqual([0, 1]);
    expect(levels.integrations).toEqual([0, 2]);
    expect(levels.settings).toEqual([0, 1, 2]);
    expect(levels.orders).toEqual([0, 1, 2, 3]);
    expect(maxLevel("listings")).toBe(2);
    expect(maxLevel("payouts")).toBe(3);
  });

  it("role defaults reproduce today's access", () => {
    expect(ROLE_DEFAULTS.accountant).toEqual({
      overview: 1, analytics: 1, orders: 2, expenses: 2, purchases: 2, inventory: 2,
      payouts: 1, integrations: 0, listings: 0, messages: 0, audit_logs: 0, settings: 1,
    });
    for (const k of SECTION_KEYS) {
      expect(ROLE_DEFAULTS.admin[k]).toBe(maxLevel(k));
      expect(ROLE_DEFAULTS.super_admin[k]).toBe(maxLevel(k));
    }
  });

  it("plan ceiling", () => {
    expect(planAllows("integrations", "starter")).toBe(false);
    expect(planAllows("integrations", "pro")).toBe(true);
    expect(planAllows("listings", "pro")).toBe(false);
    expect(planAllows("messages", "business")).toBe(true);
    expect(planAllows("orders", null)).toBe(true);
    expect(applyPlanCeiling(ROLE_DEFAULTS.admin, "pro")).toMatchObject({ integrations: 2, listings: 0, messages: 0, orders: 3 });
  });

  it("effectiveAccess: exceptions win, super_admin locked to max, plan ceiling applied", () => {
    const a = effectiveAccess("accountant", { analytics: 0, purchases: 1, integrations: 2 }, "business");
    expect(a).toMatchObject({ analytics: 0, purchases: 1, integrations: 2, orders: 2 });
    expect(effectiveAccess("super_admin", { orders: 0 }, "business").orders).toBe(3);
    expect(effectiveAccess("accountant", { listings: 2 }, "pro").listings).toBe(0);
  });

  it("parseAccessMap validates and falls back per key", () => {
    expect(parseAccessMap({ ...ROLE_DEFAULTS.accountant, orders: 0 }, "accountant").orders).toBe(0);
    expect(parseAccessMap({ orders: 7, analytics: "x" }, "accountant")).toMatchObject({ orders: 2, analytics: 1 });
    expect(parseAccessMap(null, "admin")).toEqual(ROLE_DEFAULTS.admin);
  });

  it("maps paths to sections", () => {
    expect(sectionForPath("/dashboard")).toBe("overview");
    expect(sectionForPath("/dashboard/analytics")).toBe("analytics");
    expect(sectionForPath("/dashboard/sales/abc")).toBe("orders");
    expect(sectionForPath("/dashboard/integrations/review")).toBe("integrations");
    expect(sectionForPath("/dashboard/audit-logs")).toBe("audit_logs");
    expect(sectionForPath("/dashboard/users/1/permissions")).toBe("users");
    expect(sectionForPath("/dashboard/support")).toBeNull();
    expect(sectionForPath("/dashboard/planner")).toBeNull();
    expect(sectionForPath("/dashboard/dropshipping")).toBeNull();
  });

  it("can / firstAccessiblePath", () => {
    expect(can(ROLE_DEFAULTS.accountant, "orders", 3)).toBe(false);
    expect(can(ROLE_DEFAULTS.accountant, "orders", 2)).toBe(true);
    expect(firstAccessiblePath({ ...NONE, expenses: 1 })).toBe("/dashboard/expenses");
    expect(firstAccessiblePath(NONE)).toBe("/dashboard/support");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/lib/permissions/sections` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/permissions/sections.ts`:

```ts
/**
 * Section permissions — the TypeScript mirror of migration 055's
 * role_section_default / section_level_allowed. Pure and client-safe.
 * The database is the enforcement; this drives the UI, proxy.ts and
 * server guards. Parity with SQL is checked by
 * sectionPermissions.integration.test.ts.
 */
import type { TenantPlan, UserRole } from "@/types";
import { hasMessagingAndListings, hasPlatformIntegrations } from "@/lib/utils/planGating";

export type Section =
  | "overview" | "analytics" | "orders" | "expenses" | "purchases" | "inventory"
  | "payouts" | "integrations" | "listings" | "messages" | "audit_logs" | "settings";
export type AccessLevel = 0 | 1 | 2 | 3;
export type AccessMap = Record<Section, AccessLevel>;

export const LEVEL_LABELS: Record<AccessLevel, string> = { 0: "None", 1: "View", 2: "Edit", 3: "Delete" };

export interface SectionDef {
  key: Section;
  label: string;
  levels: AccessLevel[];
  /** Route prefixes (longest match wins); empty for action-only sections. */
  routes: string[];
  description: string;
}

export const SECTIONS: SectionDef[] = [
  { key: "overview", label: "Overview", levels: [0, 1], routes: ["/dashboard"], description: "Home totals and platform cards" },
  { key: "analytics", label: "Analytics", levels: [0, 1], routes: ["/dashboard/analytics"], description: "Charts" },
  { key: "orders", label: "Orders", levels: [0, 1, 2, 3], routes: ["/dashboard/sales"], description: "Orders and shipping labels" },
  { key: "expenses", label: "Expenses", levels: [0, 1, 2, 3], routes: ["/dashboard/expenses"], description: "Expense records" },
  { key: "purchases", label: "Purchases", levels: [0, 1, 2, 3], routes: ["/dashboard/purchases"], description: "Inventory purchases" },
  { key: "inventory", label: "Inventory", levels: [0, 1, 2, 3], routes: ["/dashboard/inventory"], description: "Products, stock, locations, transfers" },
  { key: "payouts", label: "Payouts", levels: [0, 1, 2, 3], routes: [], description: "Recorded eBay/Amazon transfers" },
  { key: "integrations", label: "Integrations", levels: [0, 2], routes: ["/dashboard/integrations"], description: "eBay/Amazon connections, Review Orders" },
  { key: "listings", label: "Listings", levels: [0, 2], routes: ["/dashboard/listings"], description: "eBay listings" },
  { key: "messages", label: "Messages", levels: [0, 2], routes: ["/dashboard/messages"], description: "eBay buyer messages" },
  { key: "audit_logs", label: "Audit logs", levels: [0, 1], routes: ["/dashboard/audit-logs"], description: "Activity trail" },
  { key: "settings", label: "Settings", levels: [0, 1, 2], routes: ["/dashboard/settings"], description: "Company profile, invoices, billing" },
];

export const SECTION_KEYS: Section[] = SECTIONS.map((s) => s.key);

export function maxLevel(section: Section): AccessLevel {
  const levels = SECTIONS.find((s) => s.key === section)!.levels;
  return levels[levels.length - 1];
}

const maxMap = (): AccessMap =>
  Object.fromEntries(SECTION_KEYS.map((k) => [k, maxLevel(k)])) as AccessMap;

export const ROLE_DEFAULTS: Record<UserRole, AccessMap> = {
  super_admin: maxMap(),
  admin: maxMap(),
  accountant: {
    overview: 1, analytics: 1, orders: 2, expenses: 2, purchases: 2, inventory: 2,
    payouts: 1, integrations: 0, listings: 0, messages: 0, audit_logs: 0, settings: 1,
  },
};

export function planAllows(section: Section, plan: TenantPlan | null): boolean {
  if (!plan) return !["integrations", "listings", "messages"].includes(section);
  if (section === "integrations") return hasPlatformIntegrations(plan);
  if (section === "listings" || section === "messages") return hasMessagingAndListings(plan);
  return true;
}

export function applyPlanCeiling(access: AccessMap, plan: TenantPlan | null): AccessMap {
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, planAllows(k, plan) ? access[k] : 0])
  ) as AccessMap;
}

const isAllowed = (section: Section, v: unknown): v is AccessLevel =>
  typeof v === "number" && (SECTIONS.find((s) => s.key === section)!.levels as number[]).includes(v);

export function effectiveAccess(role: UserRole, exceptions: Partial<AccessMap>, plan: TenantPlan | null): AccessMap {
  const base = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.accountant;
  const merged = Object.fromEntries(
    SECTION_KEYS.map((k) => {
      if (role === "super_admin") return [k, base[k]];
      const e = exceptions[k];
      return [k, isAllowed(k, e) ? e : base[k]];
    })
  ) as AccessMap;
  return applyPlanCeiling(merged, plan);
}

/** Validate get_my_access() JSON; any missing/invalid key falls back to the role default. */
export function parseAccessMap(raw: unknown, fallbackRole: UserRole): AccessMap {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = ROLE_DEFAULTS[fallbackRole] ?? ROLE_DEFAULTS.accountant;
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, isAllowed(k, obj[k]) ? obj[k] : base[k]])
  ) as AccessMap;
}

export function sectionForPath(pathname: string): Section | "users" | null {
  if (pathname.startsWith("/dashboard/users")) return "users";
  let best: { key: Section; len: number } | null = null;
  for (const s of SECTIONS) {
    for (const r of s.routes) {
      const hit = r === "/dashboard" ? pathname === "/dashboard" : pathname === r || pathname.startsWith(`${r}/`);
      if (hit && (!best || r.length > best.len)) best = { key: s.key, len: r.length };
    }
  }
  return best?.key ?? null;
}

export function can(access: AccessMap, section: Section, min: AccessLevel): boolean {
  return access[section] >= min;
}

export function firstAccessiblePath(access: AccessMap): string {
  const s = SECTIONS.find((d) => d.routes.length > 0 && access[d.key] >= 1);
  return s ? s.routes[0] : "/dashboard/support";
}
```

- [ ] **Step 4: Run** `npx jest src/lib/permissions/sections` → PASS.

- [ ] **Step 5: Docs.** Add to root `AGENTS.md`'s shared `src/lib/*` list:

```md
- `src/lib/permissions/` (2026-09-30) — section permissions. `sections.ts`
  (pure: 12 sections, levels 0–3, `ROLE_DEFAULTS` mirroring migration 055,
  `effectiveAccess`, `sectionForPath`, plan ceiling), `requireSectionAccess.ts`
  (server-only route guard via the `current_user_access` RPC). The database
  (055's `install_section_permissions`) is the enforcement.
```

- [ ] **Step 6: Commit** `feat(permissions): sections access model` (include `sectionPermissions.integration.test.ts` if Task 1 deferred it).

---

### Task 3: Access state, hydration and the route guard

**Files:**
- Modify: `src/store/slices/currentUserSlice.ts` (+ create `src/store/slices/currentUserSlice.test.ts` if absent, else extend)
- Create: `src/store/useAccess.ts`
- Modify: `src/app/dashboard/layout.tsx`, `src/store/StoreProvider.tsx`
- Modify: `src/proxy.ts`
- Docs: `src/app/dashboard/CLAUDE.md` (layout hydration paragraph), `src/lib/utils/SKILL.md` or `src/app/dashboard/SKILL.md` (gotcha)

**Interfaces:**
- Consumes: `parseAccessMap`, `applyPlanCeiling`, `ROLE_DEFAULTS`, `sectionForPath`, `firstAccessiblePath`, `can`, `AccessMap` (Task 2).
- Produces: `currentUserSlice` state `access: AccessMap | null`, action `setAccess(AccessMap)`; `useAccess(): { access: AccessMap; can(section, min): boolean; level(section): AccessLevel }` (falls back to `effectiveAccess(role, {}, plan)` while `access` is null).

- [ ] **Step 1: Failing slice test** (append or create `src/store/slices/currentUserSlice.test.ts`):

```ts
import { currentUserSlice, setAccess } from "./currentUserSlice";
import { ROLE_DEFAULTS } from "@/lib/permissions/sections";

describe("currentUserSlice access", () => {
  it("starts null and stores the hydrated map", () => {
    const init = currentUserSlice.reducer(undefined, { type: "@@init" });
    expect(init.access).toBeNull();
    const next = currentUserSlice.reducer(init, setAccess({ ...ROLE_DEFAULTS.accountant, orders: 0 }));
    expect(next.access?.orders).toBe(0);
  });
});
```

Run `npx jest src/store/slices/currentUserSlice` → FAIL.

- [ ] **Step 2: Implement slice** — in `currentUserSlice.ts` import `type AccessMap` from `@/lib/permissions/sections`; add to the state interface:

```ts
  /** Section access from get_my_access() (055) with the plan ceiling applied; null until hydrated. */
  access: AccessMap | null;
```
initial `access: null`, reducer `setAccess(state, action: PayloadAction<AccessMap>) { state.access = action.payload; }`, export `setAccess`. Run the test → PASS.

- [ ] **Step 3: `src/store/useAccess.ts`:**

```ts
"use client";

import { useAppSelector } from "./hooks";
import { can as canAccess, effectiveAccess, type AccessLevel, type AccessMap, type Section } from "@/lib/permissions/sections";

/** Current user's section access. Before hydration falls back to role defaults (plan-capped). */
export function useAccess(): { access: AccessMap; can: (s: Section, min: AccessLevel) => boolean; level: (s: Section) => AccessLevel } {
  const stored = useAppSelector((s) => s.currentUser.access);
  const role = useAppSelector((s) => s.currentUser.profile?.role) ?? "accountant";
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const access = stored ?? effectiveAccess(role, {}, plan);
  return { access, can: (s, min) => canAccess(access, s, min), level: (s) => access[s] };
}
```

- [ ] **Step 4: Hydrate in `layout.tsx`.** After the `tenantPlan`/`aiEnabled` block, add:

```ts
  // Section access (055). get_my_access() applies role defaults + the
  // user's exceptions; the plan ceiling is applied here. Falls back to role
  // defaults if the RPC fails (e.g. 055 not applied yet).
  const { data: rawAccess, error: accessError } = await supabase.rpc("get_my_access");
  if (accessError) console.error("[dashboard/layout] get_my_access failed", accessError);
  const access = applyPlanCeiling(parseAccessMap(accessError ? null : rawAccess, profile.role), tenantPlan);
```
(import `applyPlanCeiling`, `parseAccessMap` from `@/lib/permissions/sections`), and pass `access={access}` to `<StoreProvider>`. In `StoreProvider.tsx` add `access?: AccessMap` to the props, destructure it, and `if (access) store.dispatch(setAccess(access));` next to `setCurrentUser`.

- [ ] **Step 5: Route guard in `proxy.ts`.** Replace the profile select `"role, status, permission_overrides"` with `"role, status"` (and its type), remove the `canAccessRoute` import and block, and insert after the deactivated check:

```ts
    const role = (profile?.role ?? "accountant") as UserRole;
    const section = sectionForPath(pathname);

    if (section === "users" && role !== "super_admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    if (section && section !== "users") {
      // 055: role defaults + per-user exceptions, capped by the plan. Fails
      // open to role defaults if the RPC errors (same posture as above).
      const { data: rawAccess, error: accessError } = await supabase.schema(tenantSchema).rpc("get_my_access");
      const access = applyPlanCeiling(
        parseAccessMap(accessError ? null : rawAccess, role),
        tenantRow?.plan ?? null,
      );
      if (!can(access, section, 1)) {
        const url = request.nextUrl.clone();
        url.pathname = section === "overview" ? firstAccessiblePath(access) : "/dashboard";
        url.search = section === "overview" ? "" : `?denied=${section}`;
        if (url.pathname !== pathname) return NextResponse.redirect(url);
      }
    }
```
(imports: `sectionForPath`, `parseAccessMap`, `applyPlanCeiling`, `can`, `firstAccessiblePath` from `@/lib/permissions/sections`). Keep the dropshipping platform-admin gate unchanged. Guard against a loop: when `overview` is 0 and `firstAccessiblePath` is also `/dashboard` nothing redirects (the `url.pathname !== pathname` check).

- [ ] **Step 6: Home toast.** In `src/app/dashboard/page.tsx`, read `useSearchParams().get("denied")`; if set, `toastError("No access", \`You don't have access to ${label}.\`)` once (label from `SECTIONS`), then `router.replace("/dashboard")`. Follow how other pages read search params in this Next.js version (check `node_modules/next/dist/docs/` for `useSearchParams` + Suspense requirements).

- [ ] **Step 7: Run** `npx jest src/store src/lib/permissions` → PASS. **Commit** `feat(permissions): hydrate section access and guard routes`. Docs: in `dashboard/CLAUDE.md`'s `layout.tsx` entry add the `get_my_access` hydration sentence; add a gotcha to `src/app/dashboard/SKILL.md`: "Access = `get_my_access()` + plan ceiling, loaded per request in both `layout.tsx` and `proxy.ts`; both fail open to role defaults so the app keeps working before 055 is applied."

---

### Task 4: Server route guards

**Files:**
- Create: `src/lib/permissions/requireSectionAccess.ts`
- Modify: `src/lib/integrations/authGuard.ts`, `src/lib/ai/authGuard.ts`
- Modify: `src/app/api/listings/{ebay/sync,[id]/publish,[id]/revise,[id]/end,[id]/ebay-detail,[id]/apply-marketing}/route.ts`, `src/app/api/messages/{ebay/sync,[id]/reply}/route.ts`, `src/app/api/shipping/{rates,buy}/route.ts`
- Docs: `src/lib/integrations/SKILL.md`, `src/lib/ai/` notes if present, `src/lib/shipping/SKILL.md`

**Interfaces:**
- Consumes: `Section`, `AccessLevel` (Task 2).
- Produces: `requireSectionAccess(section: Section, minLevel: AccessLevel): Promise<IntegrationAuthResult>` (same result type as `requireIntegrationAdmin`, re-exported from `@/lib/integrations/authGuard`).

- [ ] **Step 1: Implement** `src/lib/permissions/requireSectionAccess.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AccessLevel, Section } from "./sections";

export interface IntegrationAuthContext {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  tenantSchema: string;
}

export type IntegrationAuthResult =
  | { context: IntegrationAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Route guard for section permissions (055): signed in, belongs to a tenant,
 * and current_user_access(section) >= minLevel. The RPC applies role
 * defaults + per-user exceptions exactly like the RLS policies do, so the
 * route and the database can't disagree. Never returns a raw DB error.
 */
export async function requireSectionAccess(section: Section, minLevel: AccessLevel): Promise<IntegrationAuthResult> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) return { error: NextResponse.json({ error: "No tenant schema on user" }, { status: 400 }) };

  const { data: level, error } = await client.rpc("current_user_access", { p_section: section });
  if (error) {
    console.error("[requireSectionAccess] current_user_access failed", { section, code: error.code });
    return { error: NextResponse.json({ error: "Could not verify access" }, { status: 500 }) };
  }
  if (typeof level !== "number" || level < minLevel) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { context: { client, userId: user.id, tenantSchema } };
}
```
(Check whether `createClient()` from `@/lib/supabase/server` targets the tenant schema by default — `requireIntegrationAdmin` queries `profiles` with it unqualified, so it does.)

- [ ] **Step 2: `requireIntegrationAdmin`** becomes a thin wrapper (keep the export name — many routes import it):

```ts
/** Integrations routes: section `integrations` at Edit (055). */
export async function requireIntegrationAdmin(): Promise<IntegrationAuthResult> {
  return requireSectionAccess("integrations", 2);
}
```
Remove its body's profile query, the `hasPermission` import and its local `IntegrationAuthContext`/`IntegrationAuthResult` declarations (now defined in `requireSectionAccess.ts`); re-export them so existing imports keep working: `export type { IntegrationAuthContext, IntegrationAuthResult } from "@/lib/permissions/requireSectionAccess";` and `import { requireSectionAccess } from "@/lib/permissions/requireSectionAccess";`.

- [ ] **Step 3: Listings/messages routes (8 files).** In each, replace `const auth = await requireIntegrationAdmin();` with `const auth = await requireSectionAccess("listings", 2);` (listings routes) or `("messages", 2)` (messages routes), and delete the following `profiles` select + `hasPermission` check block and the now-unused imports (`hasPermission`, `Profile` if unused). Keep everything after `const { client, userId } = auth.context;`.

- [ ] **Step 4: AI guard.** In `src/lib/ai/authGuard.ts` `requireAiAccess()`, replace the profile + `hasPermission(…"manage_listings"…)` check with a `current_user_access('listings') >= 2` RPC check (same 403 on failure); keep its plan/`ai_enabled`/quota logic untouched.

- [ ] **Step 5: Shipping routes.** In `src/app/api/shipping/rates/route.ts` and `buy/route.ts` replace `requireIntegrationAdmin()` with `requireSectionAccess("orders", 3)` (buying a label spends money — matches the `shipments` INSERT rule). Keep `requireShippingLabelAccess(tenantSchema)`.

- [ ] **Step 6: Verify nothing else imports `hasPermission`** — `grep -rn "hasPermission\|canAccessRoute" src --include=*.ts --include=*.tsx` must list only `src/lib/utils/permissions.ts`, its test, and the client pages handled in Task 5/7. Run existing guard tests if any (`npx jest src/lib/integrations src/lib/ai src/app/api`). **Commit** `feat(permissions): section-based server guards`, docs updated in the same commit (integrations/shipping SKILL.md: "guards call `requireSectionAccess` (055); `requireIntegrationAdmin` = integrations ≥ 2").

---

### Task 5: Sidebar and button gating

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify (gating): `src/app/dashboard/page.tsx` (Record Transfer, Recent Orders), `src/app/dashboard/sales/page.tsx` + `[id]/page.tsx`, `src/app/dashboard/expenses/page.tsx`, `src/app/dashboard/purchases/page.tsx`, `src/app/dashboard/inventory/page.tsx` (+ its locations/transfers tabs), `src/app/dashboard/settings/page.tsx` (+ `BillingSection` untouched), `src/app/dashboard/sales/_components/{AddSaleModal,EditSaleModal}.tsx` and `src/app/dashboard/purchases/_components/{AddPurchaseModal,EditPurchaseModal}.tsx` (product picker), `src/app/dashboard/messages/page.tsx`, `src/app/dashboard/listings/page.tsx`, `src/app/dashboard/integrations/page.tsx` + `review/page.tsx`, `src/app/dashboard/dropshipping/page.tsx` (drop `hasPermission`: keep refresh for platform admins as today — use `role === "admin" || role === "super_admin"` there since dropshipping is outside the grid)
- Docs: each touched feature's `CLAUDE.md` (one line: "buttons gated by `useAccess()` — section X"), `src/components/layout/` docs

**Interfaces:**
- Consumes: `useAccess()` (Task 3), `Section`.

- [ ] **Step 1: Sidebar.** Replace `roles: UserRole[]` on `NavItem` with `section?: Section | "users"` (Overview→`overview`, Analytics→`analytics`, Orders→`orders`, Expenses→`expenses`, Purchases→`purchases`, Inventory→`inventory`, Audit Logs→`audit_logs`, Users→`"users"`, Integrations→`integrations`, Listings→`listings`, Messages→`messages`, Settings→`settings`; Planner and Support have none). Filter:

```ts
  const { access } = useAccess();
  const visibleItems = NAV_ITEMS.filter((item) =>
    !item.section ? true : item.section === "users" ? role === "super_admin" : access[item.section] >= 1
  );
```
(Note: Integrations/Listings/Messages were previously listed for every role and gated inside the page; now accountants without access don't see them — intended.)

- [ ] **Step 2: Page buttons.** In each listed page, add `const { can } = useAccess();` and gate:
  - Orders/Expenses/Purchases/Inventory list pages: primary "Add …" and "Import" buttons → `can(section, 2)`; row Edit icon → `can(section, 2)`; row Delete icon → `can(section, 3)` (replaces existing `canDelete` role/override logic — delete the `permission_overrides` reads); CSV export stays at View.
  - `sales/[id]/page.tsx`: Edit Order → `can("orders", 2)`; Delete → `can("orders", 3)`; "Generate Shipping Label" (EasyPost) → `can("orders", 3)` replacing `canGenerateLabel`; "Download Shipping Label" (plain PDF) unchanged (View).
  - Inventory: stock locations create/edit/deactivate and platform defaults → `can("inventory", 3)`; transfers create/undo → `can("inventory", 2)`.
  - Home (`dashboard/page.tsx`): `canRecordTransfer` → `can("payouts", 2)`; render `<RecentOrdersCard/>` only when `can("orders", 1)`.
  - Settings: form save buttons → `can("settings", 2)`, fields `disabled` when not; Billing section unchanged (`canManageBilling` from the API).
  - Integrations/Listings/Messages/Review pages: replace `hasPermission(role, "manage_…", overrides)` with `can("integrations" | "listings" | "messages", 2)`.
  - Sale/Purchase Add/Edit modals: render the "Inventory Product" select only when `can("inventory", 1)`; otherwise keep free-text product name (the existing field).
  Search for every remaining gate with `grep -rn "permission_overrides\|hasPermission\|role === \"admin\"\|isAdmin" src/app/dashboard` and convert those that correspond to a section action; leave pure role checks that aren't grid actions (e.g. billing) as they are.

- [ ] **Step 3: Tests.** Existing feature tests must still pass: `npx jest src/app/dashboard src/components`. If a pure gating helper is extracted anywhere, add a colocated test.

- [ ] **Step 4: Browser check.** Skip if no Playwright MCP + running dev server; otherwise log in as an accountant with default access and confirm Integrations/Listings/Messages/Audit Logs are absent from the sidebar and Delete icons are hidden on Orders. Report what was checked.

- [ ] **Step 5: Commit** `feat(permissions): gate sidebar and actions by section access` with the docs.

---

### Task 6: `accessDiff` pure helper

**Files:**
- Create: `src/app/dashboard/users/_lib/accessDiff.ts`
- Test: `src/app/dashboard/users/_lib/accessDiff.test.ts`

**Interfaces:**
- Consumes: `AccessMap`, `Section`, `ROLE_DEFAULTS`, `SECTION_KEYS` (Task 2).
- Produces:
  - `exceptionsToGrid(role: UserRole, rows: { section: Section; level: AccessLevel }[]): AccessMap` (role defaults overlaid by rows; no plan ceiling — the editor shows stored intent)
  - `diffAccess(role: UserRole, saved: AccessMap, edited: AccessMap): { upserts: { section: Section; level: AccessLevel }[]; deletes: Section[] }` — for each section where `edited ≠ saved`: if `edited === ROLE_DEFAULTS[role][section]` → delete, else upsert.
  - `customSections(role: UserRole, grid: AccessMap): Section[]` — sections differing from the role default.

- [ ] **Step 1: Failing test:**

```ts
import { exceptionsToGrid, diffAccess, customSections } from "./accessDiff";
import { ROLE_DEFAULTS } from "@/lib/permissions/sections";

const D = ROLE_DEFAULTS.accountant;

describe("accessDiff", () => {
  it("overlays exception rows on role defaults", () => {
    expect(exceptionsToGrid("accountant", [{ section: "analytics", level: 0 }])).toEqual({ ...D, analytics: 0 });
  });

  it("upserts changed non-default cells, deletes cells set back to default, ignores unchanged", () => {
    const saved = { ...D, analytics: 0, purchases: 1 };
    const edited = { ...D, analytics: 1, purchases: 1, payouts: 2 };
    expect(diffAccess("accountant", saved, edited)).toEqual({
      upserts: [{ section: "payouts", level: 2 }],
      deletes: ["analytics"],
    });
  });

  it("reset to defaults deletes every custom section", () => {
    const saved = { ...D, analytics: 0, orders: 3 };
    expect(diffAccess("accountant", saved, D)).toEqual({ upserts: [], deletes: ["analytics", "orders"] });
  });

  it("lists custom sections", () => {
    expect(customSections("accountant", { ...D, orders: 3 })).toEqual(["orders"]);
    expect(customSections("accountant", D)).toEqual([]);
  });
});
```
Run `npx jest dashboard/users/_lib/accessDiff` → FAIL.

- [ ] **Step 2: Implement:**

```ts
import { ROLE_DEFAULTS, SECTION_KEYS, type AccessLevel, type AccessMap, type Section } from "@/lib/permissions/sections";
import type { UserRole } from "@/types";

/** Stored exception rows → full grid (role defaults overlaid). No plan ceiling: the editor shows stored intent. */
export function exceptionsToGrid(role: UserRole, rows: { section: Section; level: AccessLevel }[]): AccessMap {
  const grid = { ...ROLE_DEFAULTS[role] };
  for (const r of rows) grid[r.section] = r.level;
  return grid;
}

/** What to write when saving: only changed cells; a cell equal to the role default is a delete. */
export function diffAccess(role: UserRole, saved: AccessMap, edited: AccessMap) {
  const upserts: { section: Section; level: AccessLevel }[] = [];
  const deletes: Section[] = [];
  for (const k of SECTION_KEYS) {
    if (edited[k] === saved[k]) continue;
    if (edited[k] === ROLE_DEFAULTS[role][k]) deletes.push(k);
    else upserts.push({ section: k, level: edited[k] });
  }
  return { upserts, deletes };
}

export function customSections(role: UserRole, grid: AccessMap): Section[] {
  return SECTION_KEYS.filter((k) => grid[k] !== ROLE_DEFAULTS[role][k]);
}
```
Run → PASS. **Commit** `feat(users): accessDiff helper for the Permissions screen` (+ `users/CLAUDE.md` file-map line).

---

### Task 7: Permissions screen, Users page, retire the old matrix

**Files:**
- Create: `src/app/dashboard/users/[id]/permissions/page.tsx`
- Modify: `src/app/dashboard/users/page.tsx`
- Delete: `src/app/dashboard/users/_components/PermissionsModal.tsx`, `src/lib/utils/permissions.ts`, `src/lib/utils/permissions.test.ts` (only if nothing imports them after Tasks 4–5; otherwise remove only the dead exports)
- Docs: `src/app/dashboard/users/CLAUDE.md` + `SKILL.md`, `src/lib/utils/SKILL.md` (remove permissions.ts entry), root `AGENTS.md` if it mentions `permissions.ts`

**Interfaces:**
- Consumes: `SECTIONS`, `LEVEL_LABELS`, `ROLE_DEFAULTS`, `planAllows` (Task 2); `exceptionsToGrid`, `diffAccess`, `customSections` (Task 6); `useAccess` not needed (super_admin only); `writeAuditLog`/`addAuditLog`; `useToast`.

- [ ] **Step 1: Page** `src/app/dashboard/users/[id]/permissions/page.tsx` (Client Component; read the Next.js docs for dynamic route `params` in this version first). Behaviour:
  - Guard: if current user isn't super_admin → render "Only the account owner can manage permissions." (proxy already blocks). Target = `state.users.items.find(id)`; if missing → not-found message with back link.
  - If target is super_admin → message "The account owner always has full access." and no grid.
  - Load: `supabase.from("user_section_access").select("section, level").eq("user_id", id)` (bounded: ≤ 12 rows per user — comment the bound for the verifier) → `saved = exceptionsToGrid(role, rows)`; `edited` state starts as `saved`.
  - Layout: back link `<ChevronLeft size={16}/> Users` → `/dashboard/users`; `text-2xl font-bold` name; role `RoleBadge`; secondary `Reset to role defaults` button (opens `DeleteConfirmModal` with `confirmLabel="Reset"` / `confirmingLabel="Resetting…"` and no reason field if the modal supports it; otherwise a `ConfirmActionModal`-style existing component) that sets `edited = ROLE_DEFAULTS[role]` (the user then saves).
  - Grid: `<form id="permissions-form" onSubmit={handleSave}>` with a table: rows = `SECTIONS`, columns = None/View/Edit/Delete; each cell is a radio (`name={section}`) when the level is in `section.levels`, else "─". A row whose section `!planAllows(key, tenantPlan)` is disabled with a `Badge` "Not in your plan". A row in `customSections(role, edited)` shows `Badge` "custom" + `text-xs` "role default: {LEVEL_LABELS[ROLE_DEFAULTS[role][key]]}". Radios have accessible labels (`aria-label={\`${label}: ${LEVEL_LABELS[l]}\`}`).
  - Footer: `Cancel` (secondary → back) and `Save changes` (`type="submit" form="permissions-form"`, `disabled={saving || diff is empty}`, label "Saving…" while saving).
  - Save: `const { upserts, deletes } = diffAccess(role, saved, edited)`; `deletes` → `.delete().eq("user_id", id).in("section", deletes)`; `upserts` → `.upsert(upserts.map((u) => ({ user_id: id, ...u })), { onConflict: "user_id,section" })`. On error: `toastError("Couldn't save permissions", "Please try again.")` (never the raw DB message). On success: `writeAuditLog` (`action: "update"`, `entityType` — use the existing type used for users, `metadata: { user_access: { before: saved, after: edited } }`), dispatch `addAuditLog`, `success("Permissions saved", …)`, set `saved = edited`.
- [ ] **Step 2: Users page.** Replace the "Permissions" button's `setPermissionsTarget` with a `Link` to `/dashboard/users/${p.id}/permissions` (hidden for super_admin rows); remove `PermissionsModal` usage and state. Load all exception rows once (`user_section_access` select `user_id, section, level` — bounded by users × 12; comment it) and show a `Badge` "Custom access" in the Role column for users with `customSections(...)` non-empty.
- [ ] **Step 3: Retire.** Delete `PermissionsModal.tsx`. `grep -rn "lib/utils/permissions" src`; if empty, delete `src/lib/utils/permissions.ts` and its test; else remove only the unused exports. Keep `Profile.permission_overrides` in types (column still exists).
- [ ] **Step 4: Tests.** `npx jest src/app/dashboard/users src/lib` → PASS (delete-only changes to tests are expected for `permissions.test.ts`).
- [ ] **Step 5: Browser check** (Playwright MCP + running dev server only; else skip and say so): open a user's permissions page, set Analytics → None, save, confirm the toast and the "custom" badge; reset to defaults, save, confirm the badge clears.
- [ ] **Step 6: Commit** `feat(users): Permissions screen; retire legacy permission matrix` with docs (users `CLAUDE.md` file map incl. `[id]/permissions/page.tsx`, `_lib/accessDiff.ts`; `SKILL.md` gotchas: "exceptions only are stored; role change cleanup is a DB trigger; super_admin rows are locked; plan ceiling is display-only here").

---

### Task 8: Final verification and docs sweep

**Files:**
- Modify: any `CLAUDE.md`/`SKILL.md` still describing `hasPermission`, `permission_overrides` overrides, `PermissionsModal`, or role-only gates (`grep -rln "hasPermission\|PermissionsModal\|permission_overrides\|canAccessRoute" --include=*.md .`).

- [ ] **Step 1:** Update each hit to describe section permissions (point at `src/lib/permissions/` and migration 055). Keep historical notes that are explicitly dated.
- [ ] **Step 2:** Run `npx jest` (full suite) → PASS; `uv run .claude/verifiers/verify_changes.py` → no new findings in changed files (the two bounded `user_section_access` reads carry a `// verifier:allow unpaginated-collection-read — ≤ 12 rows per user` comment if flagged).
- [ ] **Step 3: Commit** `docs: section permissions sweep`.

**Manual acceptance (user, after 055 applied and the app deployed):** create a test accountant; as super_admin set Orders → None, Purchases → View, Analytics → None. Log in as the test user: Orders/Analytics absent from the sidebar and their URLs redirect with a toast; Home totals still show real revenue; Purchases shows no Add/Edit/Delete; opening `/dashboard/sales` data via the browser console (`supabase.from("sales").select()`) returns no rows. Then reset to defaults and confirm access returns.
