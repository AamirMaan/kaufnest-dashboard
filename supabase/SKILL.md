---
name: supabase-migrations
description: Reference for the SQL migration files in supabase/ (Project A control plane + Project B data plane, tenant provisioning) — use when adding/changing a table, column, index, RLS policy, or trigger, or when reasoning about what has/hasn't been applied to the live databases.
---

# Supabase migrations (`supabase/`)

Two Supabase projects:

- **Project A** ("control plane", schema `control`) —
  `supabase/control-plane/{001_schema,002_grants}.sql`. Tracks tenants
  (`control.tenants`) and platform admins (`control.admin_users`).
- **Project B** ("data plane") — `supabase/migrations/`. Hosts the original
  `public` schema (one company) plus one `tenant_<slug>` schema per tenant.
  `tenant_kaufnest` is the first (and currently only) tenant.

## File map + apply status

| File | Targets | Status |
| --- | --- | --- |
| `migrations/001_init.sql` | `public` | ✅ applied — baseline tables, enums, RLS, indexes |
| `migrations/002_inventory_and_vat.sql` | `public` | ✅ applied — `products`, VAT columns, stock-sync triggers |
| `migrations/003_add_order_status.sql` | `public.sales` | ✅ applied — `status`/`restock` columns + return-aware stock trigger |
| `migrations/004_performance_indexes.sql` | `tenant_kaufnest.*` | ⏳ **apply now** — 6 new growth indexes on the live tenant schema |
| `migrations/005_tenant_provisioning.sql` | `public` functions | ✅ applied — defines `provision_tenant_schema()` + `set_user_tenant()`, used by Phase 4 |
| `migrations/006_bootstrap_tenant_kaufnest.sql` | `tenant_kaufnest` | ✅ applied — **do not re-run**, historical record only |
| `migrations/007_company_profile_invoice_fields.sql` | `tenant_kaufnest.company_profile` | ⏳ **apply now** — adds `tax_id`/`phone`/`email`/`vat_rate`/`bank_name`/`iban`/`bic`/`invoice_prefix`/`payment_terms`/`footer_notes` columns (folds the old localStorage invoice settings into `company_profile`) |
| `migrations/008_platform_integrations.sql` | `tenant_kaufnest` | ⏳ **apply now** — adds `platform_connections` table (+ RLS, admin/super_admin-only including SELECT) and `sales.external_order_id` + unique `(platform, external_order_id)` index, for the Integrations feature (`src/lib/integrations/`) |
| `migrations/010_order_fees.sql` | `tenant_kaufnest.sales` | ⏳ **pending** (apply in Supabase SQL editor — Project B) — adds `shipping_cost`, `shipping_charged`, `advertising_fee` nullable `numeric(12,2)` columns with `>= 0` CHECKs; also baked into `provision_tenant_schema()` for future tenants |
| `control-plane/001_schema.sql` | `control` (Project A) | ✅ applied |
| `control-plane/002_grants.sql` | `control` (Project A) | ⏳ **apply now** — `service_role`/`sb_secret_*` needs explicit `USAGE`/table grants on `control` (CREATE SCHEMA grants nothing by default); fixes `42501 permission denied for schema control` on `createControlClient()` |
| `control-plane/003_add_admin_email.sql` | `control.tenants` (Project A) | ⏳ **apply now** — adds nullable `admin_email` column, shown in `/admin`'s tenants table |

`tenant_kaufnest` already exists in Project B with all data migrated, RLS +
grants in place, and Phase 3 client routing verified (see
`SAAS_MIGRATION.md` Phase 2/3 checklists). With 005 applied, Phase 4 dynamic
provisioning (`/api/admin/provision-tenant`) is code-complete — see
`src/app/admin/SKILL.md`. The outstanding pieces are 004, 007, and 008, all
additive/idempotent and safe to run anytime.

## Apply order (for a fresh Project B, disaster recovery)

1. `001_init.sql`
2. `002_inventory_and_vat.sql`
3. `003_add_order_status.sql`
4. `005_tenant_provisioning.sql` (defines `provision_tenant_schema`, `set_user_tenant`)
5. `006_bootstrap_tenant_kaufnest.sql` (provisions `tenant_kaufnest`, migrates data)
6. `004_performance_indexes.sql` (adds the 6 growth indexes — also baked into
   `provision_tenant_schema()` for any tenant provisioned by step 4/5, but
   `tenant_kaufnest` was provisioned by 006 *before* 004 existed, so it needs
   this run separately)

For new tenants created via Phase 4 (`/api/admin/provision-tenant` →
`provision_tenant_schema(schema_name)`), steps 4/5/6 above are all baked into
one function call — no separate migration needed.

## The "3 places" rule for schema changes

Any change to `sales`/`purchases`/`expenses`/`products`/etc. that should apply
to **every** tenant (existing and future) touches up to three places:

1. **`public.*`** (if still relied on by anything — currently only kept until
   Phase 3.6 drops it; usually skip this).
2. **`provision_tenant_schema()`** in `005_tenant_provisioning.sql` — so every
   *future* tenant gets the change from schema creation.
3. **A one-off `ALTER TABLE tenant_kaufnest.*` migration** — `tenant_kaufnest`
   (and any other already-provisioned tenant) won't pick up changes to #2
   retroactively; write and run a small additive migration against the live
   schema(s), the same way `004_performance_indexes.sql` does for the new
   growth indexes.

## Index rationale (004_performance_indexes.sql)

`sales` (orders), `purchases`, and `expenses` are the fastest-growing tables.
`src/app/dashboard/layout.tsx` fetches each with
`.order("date", { ascending: false }).limit(100)`, and
`src/lib/utils/filters.ts` (`SalesFilters`/`ExpenseFilters`/`PurchaseFilters`)
already define `status`/`category`/`vendor`/`created_by`-style filters applied
client-side. The new indexes prepare for pushing those filters server-side
once `select("*")` over the full table stops being viable:

- `idx_sales_created_by`, `idx_purchases_created_by` — per-user audit/report queries
- `idx_sales_date_status` `(date desc, status)` — "orders in a date range,
  excluding returns" (Overview's `effectiveSales`, Orders' Status filter)
- `idx_purchases_vendor` — Vendor filter in `PurchaseFilters`
- `idx_expenses_category` / `idx_expenses_date_category` `(date desc, category)`
  — Category filter + Overview's Expenses-by-Category breakdown

## Gotchas

- **PostgREST 42501 "permission denied for schema"**: `CREATE SCHEMA` grants
  nothing by default. Every new schema needs `GRANT USAGE ON SCHEMA ...` +
  table/sequence grants + `ALTER DEFAULT PRIVILEGES` for
  `anon, authenticated, service_role` — this check happens *before* RLS, so
  correct RLS policies alone aren't enough. `provision_tenant_schema()`
  section 7 does this for every tenant. **Project A's `control` schema
  (001_schema.sql) had the same gap** — `control-plane/002_grants.sql` fixes
  the `42501 permission denied for schema control` error
  `createControlClient()` hits in `src/app/admin/layout.tsx` and
  `src/app/api/admin/*` until it's applied.
- **"Exposed schemas" allowlist**: any schema accessed via `db.schema`/`.schema()`
  must also be listed in Project B's Project Settings → API → Data API
  Settings → Exposed schemas, or PostgREST rejects the request with 404/406.
  `tenant_kaufnest` is already listed; new tenants get added automatically by
  `/api/admin/provision-tenant` via `addExposedSchema()`
  (`src/lib/supabase/managementApi.ts`, Management API) — see
  `src/lib/supabase/SKILL.md`.
- **JWT refresh after `tenant_schema` stamp**: `set_user_tenant()` writes
  `app_metadata.tenant_schema`, but existing sessions only pick it up on their
  next JWT refresh (log out/in). Until then `is_tenant_member()` denies them.
- **`is_tenant_member()`**: every per-schema RLS policy requires
  `<schema>.is_tenant_member()` (checks
  `auth.jwt() -> 'app_metadata' ->> 'tenant_schema' = '<schema>'`) — without
  it, an authenticated user from a *different* tenant could read this schema's
  tables via `db: { schema: <other_schema> }`.
- **`CREATE INDEX CONCURRENTLY`**: cannot run inside a transaction block. The
  Supabase SQL editor wraps multi-statement pastes in a transaction, so for
  tables that have already grown large, paste each `CREATE INDEX CONCURRENTLY`
  statement individually instead of running the whole file.
- **`provision_tenant_schema()` is safely re-runnable for the same
  `schema_name`**: tables/indexes use `IF NOT EXISTS`, functions use
  `CREATE OR REPLACE`, triggers use `CREATE OR REPLACE TRIGGER` (PG14+), and
  section 5 now drops any existing policies on `schema_name` (via
  `pg_policies`) before recreating them — `CREATE POLICY` itself has no
  `IF NOT EXISTS`/`OR REPLACE`. This means retrying `/admin` → "Add Tenant"
  with the same slug after a partial failure (e.g. erroring at the
  invite/exposed-schema step) won't hit `policy ... already exists`. Step 2's
  `company_profile` seed in `provision-tenant/route.ts` is also retry-safe — it
  checks for an existing row before inserting, so a retry that got past step 2
  last time won't create a duplicate.
- **`set_tenant_search_path` was removed** — never used by app code (every
  client passes `db.schema`/`.schema()` instead, see
  `src/lib/supabase/SKILL.md`). Don't recreate it.
