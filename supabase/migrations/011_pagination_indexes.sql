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
-- These indexes are additive and are also baked into provision_tenant_schema()
-- (005_tenant_provisioning.sql), so every NEW tenant gets the same index set
-- from the start — this file only needs to run for tenant_kaufnest.
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

-- ─── products ───────────────────────────────────────────────
-- name ascending: pagination on products inventory table with alphabetical ordering.
create index if not exists idx_products_name_asc on tenant_kaufnest.products (name asc);
