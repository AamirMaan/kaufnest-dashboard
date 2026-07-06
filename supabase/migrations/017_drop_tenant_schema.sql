-- Adds drop_tenant_schema(schema_name text), called by DELETE /api/admin/tenants/[id]
-- to permanently destroy a tenant's Project B schema.
-- SECURITY DEFINER: runs as function owner so service_role can DROP any tenant schema.
-- Only service_role is granted EXECUTE — no tenant role can call this directly.

CREATE OR REPLACE FUNCTION public.drop_tenant_schema(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Safety: only allow dropping schemas whose names start with "tenant_"
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'drop_tenant_schema: schema name must start with tenant_, got %', schema_name;
  END IF;
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
END;
$$;

REVOKE ALL ON FUNCTION public.drop_tenant_schema(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drop_tenant_schema(text) TO service_role;
