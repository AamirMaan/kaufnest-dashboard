-- ============================================================
-- Phase 3 fix — grant PostgREST roles access to tenant_kaufnest
-- Run this in the Supabase SQL editor for PROJECT B.
--
-- create schema (in 004_phase2_tenant_kaufnest.sql) does NOT grant any
-- privileges to anon/authenticated/service_role. Supabase auto-grants these
-- for the `public` schema at project creation, but not for schemas created
-- afterwards. Without this, every PostgREST request against tenant_kaufnest
-- fails with "permission denied for schema tenant_kaufnest" (42501) — this
-- check happens BEFORE row-level security is evaluated, so RLS policies
-- being correct doesn't help.
-- ============================================================

grant usage on schema tenant_kaufnest to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema tenant_kaufnest
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema tenant_kaufnest
  to anon, authenticated, service_role;

-- Ensure tables/sequences added later (e.g. future ALTER TABLEs) get the
-- same grants automatically.
alter default privileges in schema tenant_kaufnest
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges in schema tenant_kaufnest
  grant usage, select on sequences to anon, authenticated, service_role;
