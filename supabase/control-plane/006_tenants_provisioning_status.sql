-- ============================================================
-- 006 — add 'provisioning' to control.tenants.status CHECK constraint
-- Run this in the Supabase SQL editor for PROJECT A (control plane).
--
-- Root cause of self-serve trial signup being completely broken
-- (confirmed live 2026-09-01, every attempt failed at the very first insert
-- in /api/signup/provision with "new row for relation tenants violates
-- check constraint tenants_status_check"): a CHECK constraint
-- (`tenants_status_check`, allowing only 'invited'/'active'/'deactivated')
-- exists live on `control.tenants.status` but was never tracked in any
-- migration file in this repo — 005_tenants_admin_email_unique.sql's header
-- comment explicitly (and, at the time, correctly) documented "No CHECK
-- constraint exists on control.tenants.status", based on 001_schema.sql's
-- plain `text not null default 'active'` column definition. Someone added
-- this constraint directly against the live database afterward, outside
-- any tracked migration, without including 'provisioning' — the status
-- /api/signup/provision has always written to its claim row before doing
-- any expensive work (see that route's own comments). This is DDL drift,
-- not a design questions: 'provisioning' is a real, load-bearing status
-- value, so the constraint is what's wrong, not the app code.
-- ============================================================

alter table control.tenants
  drop constraint if exists tenants_status_check;

alter table control.tenants
  add constraint tenants_status_check
    check (status in ('provisioning', 'invited', 'active', 'deactivated'));
