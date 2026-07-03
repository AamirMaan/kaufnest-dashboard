-- Installs public.run_on_all_tenant_schemas(sql text).
--
-- Every future migration that changes a tenant table MUST use this helper
-- instead of hardcoding ALTER TABLE tenant_kaufnest.*.
--
-- Usage:
--
--   SELECT public.run_on_all_tenant_schemas($$
--     ALTER TABLE {{schema}}.sales
--       ADD COLUMN IF NOT EXISTS my_col text;
--   $$);
--
-- {{schema}} is substituted with each discovered schema name (any schema
-- matching tenant_%) before EXECUTE. Statements must be idempotent
-- (IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS) so re-running is safe.

CREATE OR REPLACE FUNCTION public.run_on_all_tenant_schemas(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
    ORDER BY schema_name
  LOOP
    EXECUTE replace(sql, '{{schema}}', r.schema_name);
    RAISE NOTICE '[tenant-migrate] Applied to %', r.schema_name;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.run_on_all_tenant_schemas(text) IS
  'Execute DDL against every tenant_% schema. Use {{schema}} as the placeholder.';
