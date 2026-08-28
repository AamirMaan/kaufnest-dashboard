-- ============================================================
-- 005 — unique admin_email on control.tenants
-- Run this in the Supabase SQL editor for PROJECT A (control plane).
--
-- This index is the idempotency lock for self-serve signup. The provisioning
-- route (/api/signup/provision) inserts its control.tenants row with
-- status = 'provisioning' BEFORE doing any expensive work, so a double-click,
-- a page refresh, or two concurrent requests collide here (23505) instead of
-- creating two tenant schemas for one person.
--
-- Postgres treats multiple NULLs as distinct, so a plain unique index is
-- correct — existing rows with no admin_email (including tenant_kaufnest)
-- are unaffected and no partial predicate is needed.
--
-- Verified against Project A on 2026-08-28: zero duplicate non-null
-- admin_email values, so this applies cleanly to live data.
--
-- No CHECK constraint exists on control.tenants.status (001_schema.sql
-- declares it `text not null default 'active'` with an explanatory comment
-- only), so the new 'provisioning' value needs no schema change.
-- ============================================================

create unique index if not exists idx_tenants_admin_email
  on control.tenants (admin_email);
