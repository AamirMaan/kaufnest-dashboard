-- ============================================================
-- Add referral to control.tenants
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Free-text attribution field: which referrer sent this tenant, so the
-- business can identify and pay out a referral share manually. Captured at
-- self-serve signup (?ref= URL param, or typed in) or set/edited later by a
-- platform admin. No format enforcement, no relationship to plan/Stripe —
-- see docs/superpowers/specs/2026-09-04-tenant-referral-attribution-design.md.
-- Nullable — existing rows are left unset and render as "—".
-- ============================================================

alter table control.tenants add column if not exists referral text;
