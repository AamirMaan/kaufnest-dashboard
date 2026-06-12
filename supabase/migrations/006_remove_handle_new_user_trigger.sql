-- ============================================================
-- Phase 3.6 prerequisite — remove handle_new_user trigger
-- Run this in the Supabase SQL editor for PROJECT B.
--
-- handle_new_user() runs AFTER INSERT on auth.users and hardcodes
-- `insert into public.profiles (id, email) values (new.id, new.email)`.
-- Once public.profiles is dropped, this trigger would throw on every
-- signup/invite, rolling back the auth.users insert entirely.
--
-- Profile creation is now handled explicitly, per-tenant, by:
--   - src/app/api/users/invite/route.ts        (invite into an existing tenant)
--   - src/app/api/admin/provision-tenant/route.ts (new tenant's first admin)
-- both via createServiceClientForTenant(schemaName).from("profiles").insert(...)
-- ============================================================

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
