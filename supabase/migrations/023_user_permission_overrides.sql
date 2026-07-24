-- ============================================================
-- Per-user permission overrides — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- Adds `permission_overrides` to `profiles`: a jsonb array of `Permission`
-- keys (see `src/lib/utils/permissions.ts`) ADDITIVELY granted to that user
-- on top of their role's default permissions. Additive only — a super_admin
-- can use this to give e.g. an accountant `delete_sale` without changing
-- their role, but overrides can never take a permission AWAY from what the
-- role already grants. `hasPermission(role, permission, overrides)` in
-- permissions.ts is the app-layer source of truth for combining the two;
-- `current_user_has_override()` below mirrors the same logic in RLS for the
-- three DELETE policies that were previously role-only.
--
-- Writing `permission_overrides` itself is already covered by the existing
-- `profiles_manage_super_admin` policy (FOR ALL, super_admin only) — no new
-- policy needed for the write side.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets the column, the function, and the updated delete
-- policies from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.profiles
    ADD COLUMN IF NOT EXISTS permission_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

  CREATE OR REPLACE FUNCTION {{schema}}.current_user_has_override(perm text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = {{schema}}
  AS $func$
    SELECT COALESCE(
      (SELECT permission_overrides FROM profiles WHERE id = auth.uid()) ? perm,
      false
    );
  $func$;

  DROP POLICY IF EXISTS "expenses_delete" ON {{schema}}.expenses;
  CREATE POLICY "expenses_delete" ON {{schema}}.expenses FOR DELETE USING (
    {{schema}}.is_tenant_member()
    AND ({{schema}}.current_user_role() IN ('admin', 'super_admin')
         OR {{schema}}.current_user_has_override('delete_expense'))
  );

  DROP POLICY IF EXISTS "purchases_delete" ON {{schema}}.purchases;
  CREATE POLICY "purchases_delete" ON {{schema}}.purchases FOR DELETE USING (
    {{schema}}.is_tenant_member()
    AND ({{schema}}.current_user_role() IN ('admin', 'super_admin')
         OR {{schema}}.current_user_has_override('delete_purchase'))
  );

  DROP POLICY IF EXISTS "sales_delete" ON {{schema}}.sales;
  CREATE POLICY "sales_delete" ON {{schema}}.sales FOR DELETE USING (
    {{schema}}.is_tenant_member()
    AND ({{schema}}.current_user_role() IN ('admin', 'super_admin')
         OR {{schema}}.current_user_has_override('delete_sale'))
  );
$$);
