-- ============================================================
-- Bootstrap tenant_kaufnest (Project B — Data Plane)
-- ✅ Already applied — tenant_kaufnest exists in Project B with all data
-- migrated, RLS/grants in place, and Phase 3 routing verified (see
-- SAAS_MIGRATION.md Phase 2/3 checklists). DO NOT RE-RUN against the current
-- Project B: step 1 will error on already-existing RLS policies (CREATE
-- POLICY has no IF NOT EXISTS) and step 2's INSERT...SELECT will violate
-- primary-key constraints on every row.
--
-- Kept for reproducibility / disaster recovery — this is the refactored,
-- canonical form of what was originally run as 004_phase2_tenant_kaufnest.sql
-- + 006_remove_handle_new_user_trigger.sql. If Project B is ever rebuilt from
-- scratch, run 005_tenant_provisioning.sql first, then this file in full.
--
-- What this does:
--   1. Provisions the tenant_kaufnest schema via provision_tenant_schema()
--      (tables, triggers, RLS, indexes, grants — see 005_tenant_provisioning.sql)
--   2. Copies existing public.* data into tenant_kaufnest.* (your own company
--      = first tenant)
--   3. Seeds tenant_kaufnest.company_profile
--   4. Stamps every existing auth.users row with tenant_schema='tenant_kaufnest'
--   5. Removes the handle_new_user trigger (public.profiles no longer gets
--      auto-populated — profile creation is now explicit and per-tenant, see
--      src/app/api/users/invite/route.ts and
--      src/app/api/admin/provision-tenant/route.ts)
--
-- Do NOT drop public.* tables yet — only after Phase 3 browser testing
-- (see SAAS_MIGRATION.md). This consolidates the old
-- 004_phase2_tenant_kaufnest.sql (steps 1-9) and
-- 006_remove_handle_new_user_trigger.sql.
--
-- NOTE: after step 4 runs, existing logged-in sessions won't see the new
-- app_metadata.tenant_schema until their JWT refreshes (log out/in to force
-- it) — until then, tenant_kaufnest.is_tenant_member() will deny them.
-- ============================================================

-- ─── 1. Provision the schema ──────────────────────────────────
select public.provision_tenant_schema('tenant_kaufnest');

-- ─── 2. Migrate existing data from public.* ───────────────────
-- Order matters for FK constraints: profiles -> products -> expenses/sales/purchases -> audit_logs.
-- Enum columns (role, currency, category, platform, action, entity_type) are
-- cast to text since tenant schema columns are plain text.

insert into tenant_kaufnest.profiles (id, email, full_name, role, created_at)
select id, email, full_name, role::text, created_at
from public.profiles;

insert into tenant_kaufnest.products (id, name, sku, current_stock, reorder_threshold, created_by, created_at, updated_at)
select id, name, sku, current_stock, reorder_threshold, created_by, created_at, updated_at
from public.products;

insert into tenant_kaufnest.expenses (id, title, amount, currency, category, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount)
select id, title, amount, currency::text, category::text, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount
from public.expenses;

insert into tenant_kaufnest.sales (id, platform, product_name, product_id, quantity, unit_price, total_amount, currency, date, description, created_by, created_at, updated_at, vat_rate, vat_amount, status, restock)
select id, platform::text, product_name, product_id, quantity, unit_price, total_amount, currency::text, date, description, created_by, created_at, updated_at, vat_rate, vat_amount, status, restock
from public.sales;

insert into tenant_kaufnest.purchases (id, product_name, product_id, quantity, unit_price, total_amount, currency, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount)
select id, product_name, product_id, quantity, unit_price, total_amount, currency::text, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount
from public.purchases;

insert into tenant_kaufnest.audit_logs (id, user_id, user_email, action, entity_type, entity_id, metadata, created_at)
select id, user_id, user_email, action::text, entity_type::text, entity_id, metadata, created_at
from public.audit_logs;

-- ─── 3. Seed company profile ──────────────────────────────────
-- Edit name / vat_number / address afterwards via Settings -> Company.
insert into tenant_kaufnest.company_profile (name, currency, timezone)
values ('KaufNest', 'EUR', 'UTC');

-- ─── 4. Stamp existing users with tenant_schema ───────────────
select public.set_user_tenant(id, 'tenant_kaufnest') from auth.users;

-- ─── 5. Remove handle_new_user trigger ────────────────────────
-- handle_new_user() ran AFTER INSERT on auth.users and hardcoded
-- `insert into public.profiles (id, email) values (new.id, new.email)`.
-- Once public.profiles is dropped (Phase 3.6), this trigger would throw on
-- every signup/invite, rolling back the auth.users insert entirely.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ─── 6. Register in control plane (run separately in PROJECT A) ──
-- See supabase/control-plane/001_schema.sql.
