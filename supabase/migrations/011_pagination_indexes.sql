-- ============================================================
-- Pagination indexes for audit_logs and products (tenant_kaufnest schema)
-- Run this in the Supabase SQL editor for Project B.
--
-- Phase 3 (server-side pagination) introduces paging for all dashboard tables.
-- Layout (src/app/dashboard/layout.tsx) fetches audit_logs with
-- `.order("created_at", { ascending: false }).range(...)` and products with
-- `.order("name", { ascending: true }).range(...)`. These indexes prepare for
-- efficient range queries on the paginated sort columns.
--
-- TODO: these indexes should also be added to provision_tenant_schema() in
-- 005_tenant_provisioning.sql so new tenants get them from the start.
-- Tracked as a follow-up — do not edit 005 here.
--
-- All `create index if not exists` — safe to run against the live schema.
--
-- NOTE: for tables that have already grown large, prefer
-- `CREATE INDEX CONCURRENTLY` run as standalone statements (it cannot run
-- inside a transaction block, so paste each one individually into the SQL
-- editor rather than running this whole file at once).
-- ============================================================

-- ─── audit_logs ─────────────────────────────────────────────
-- created_at descending: pagination on audit_logs with most-recent-first ordering.
create index if not exists idx_audit_logs_created_at_desc on tenant_kaufnest.audit_logs (created_at desc);

-- action: eq("action", …) filter in fetchAuditLogsPage
create index if not exists idx_audit_logs_action on tenant_kaufnest.audit_logs (action);

-- user_id: eq("user_id", …) filter in fetchAuditLogsPage
create index if not exists idx_audit_logs_user_id on tenant_kaufnest.audit_logs (user_id);

-- ─── products ───────────────────────────────────────────────
-- name ascending: pagination on products inventory table with alphabetical ordering.
create index if not exists idx_products_name_asc on tenant_kaufnest.products (name asc);
