-- ============================================================
-- Control plane schema grants — fixes 42501 "permission denied for schema control"
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- `create schema` (001_schema.sql) grants nothing by default — service_role
-- (and the sb_secret_* API key, which maps to service_role) needs explicit
-- USAGE on the schema and table privileges before createControlClient()'s
-- `.schema("control")` queries (src/app/admin/layout.tsx,
-- src/app/api/admin/*) will work, even though service_role bypasses RLS.
-- ============================================================

grant usage on schema control to service_role;
grant select, insert, update, delete on all tables in schema control to service_role;
alter default privileges in schema control
  grant select, insert, update, delete on tables to service_role;
