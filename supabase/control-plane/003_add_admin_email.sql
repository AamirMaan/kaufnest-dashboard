-- ============================================================
-- Add admin_email to control.tenants
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Surfaces the tenant's admin contact (the email provisioning sends the
-- invite to) in the /admin "Tenant Management" table. Nullable — existing
-- rows (tenant_kaufnest) are left unset and render as "—".
-- ============================================================

alter table control.tenants add column if not exists admin_email text;
