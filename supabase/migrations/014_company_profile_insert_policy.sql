-- Adds the missing INSERT policy on company_profile.
-- The settings page uses .upsert() which triggers INSERT when no row exists.
-- Previously only SELECT + UPDATE policies existed, so the upsert was blocked.

SELECT public.run_on_all_tenant_schemas($$
  DROP POLICY IF EXISTS "company_profile_insert" ON {{schema}}.company_profile;
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE POLICY "company_profile_insert" ON {{schema}}.company_profile
    FOR INSERT
    WITH CHECK (
      {{schema}}.is_tenant_member()
      AND {{schema}}.current_user_role() IN ('admin', 'super_admin')
    );
$$);
