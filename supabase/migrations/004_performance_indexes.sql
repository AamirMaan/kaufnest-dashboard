-- ============================================================
-- Growth indexes for sales, purchases, expenses (tenant_kaufnest schema)
-- Run this in the Supabase SQL editor for Project B.
--
-- tenant_kaufnest is the live schema — Phase 2/3 of the SaaS migration
-- (schema creation, data copy, grants, RLS, and client routing) are already
-- applied and verified (see SAAS_MIGRATION.md). orders (sales), purchases,
-- and expenses are the fastest-growing tables. The dashboard layout
-- (src/app/dashboard/layout.tsx) fetches each of these with
-- `.order("date", { ascending: false }).limit(100)`, and the per-feature
-- filter bars (src/lib/utils/filters.ts: SalesFilters, ExpenseFilters,
-- PurchaseFilters) already define status/category/vendor filters that are
-- currently applied client-side. These indexes are additive and prepare for
-- pushing those filters server-side once `select("*")` over the full table
-- stops being viable.
--
-- These 6 indexes did not exist when tenant_kaufnest was originally
-- provisioned, so they need to be added here once. They are also baked into
-- provision_tenant_schema() (005_tenant_provisioning.sql), so every NEW
-- tenant gets the same index set from the start — this file only needs to
-- run for tenant_kaufnest.
--
-- All `create index if not exists` — safe to run against the live schema.
--
-- NOTE: for tables that have already grown large, prefer
-- `CREATE INDEX CONCURRENTLY` run as standalone statements (it cannot run
-- inside a transaction block, so paste each one individually into the SQL
-- editor rather than running this whole file at once).
-- ============================================================

-- ─── sales (orders) ─────────────────────────────────────────
-- created_by: per-user audit/report queries.
create index if not exists idx_sales_created_by on tenant_kaufnest.sales (created_by);
-- (date desc, status): "orders in date range, excluding returns" — the
-- effectiveSales filter on the Overview page and the Status filter on Orders.
create index if not exists idx_sales_date_status on tenant_kaufnest.sales (date desc, status);

-- ─── purchases ──────────────────────────────────────────────
-- created_by: per-user audit/report queries.
create index if not exists idx_purchases_created_by on tenant_kaufnest.purchases (created_by);
-- vendor: Vendor filter in PurchaseFilters.
create index if not exists idx_purchases_vendor on tenant_kaufnest.purchases (vendor);

-- ─── expenses ───────────────────────────────────────────────
-- category: Category filter in ExpenseFilters, and the Expenses-by-Category
-- breakdown on the Overview page.
create index if not exists idx_expenses_category on tenant_kaufnest.expenses (category);
-- (date desc, category): "expenses in date range, by category".
create index if not exists idx_expenses_date_category on tenant_kaufnest.expenses (date desc, category);
