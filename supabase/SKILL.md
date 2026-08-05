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
  Live tenants: `tenant_kaufnest`, `tenant_waqasmumtaz`, `tenant_hochkauf`,
  `tenant_k2_textil`, `tenant_testing`.

## File map + apply status

| File | Targets | Status |
| --- | --- | --- |
| `migrations/001_init.sql` | `public` | ✅ applied — baseline tables, enums, RLS, indexes |
| `migrations/002_inventory_and_vat.sql` | `public` | ✅ applied — `products`, VAT columns, stock-sync triggers |
| `migrations/003_add_order_status.sql` | `public.sales` | ✅ applied — `status`/`restock` columns + return-aware stock trigger |
| `migrations/004_performance_indexes.sql` | `tenant_kaufnest.*` | ⏳ **apply now** — 6 new growth indexes on the live tenant schema |
| `migrations/005_tenant_provisioning.sql` | `public` functions | ⏳ **re-apply now** — defines `provision_tenant_schema()` + `set_user_tenant()`, used by Phase 4; the function body was just MODIFIED in the repo to also provision the `notifications`/`notification_reads` tables, RLS, indexes, grants/revoke, and the three notification trigger functions (028/029) for new tenants, but the live Project B database still runs the OLD body — **until this file is re-applied, any newly provisioned tenant gets no notifications tables, policies, or triggers** |
| `migrations/006_bootstrap_tenant_kaufnest.sql` | `tenant_kaufnest` | ✅ applied — **do not re-run**, historical record only |
| `migrations/007_company_profile_invoice_fields.sql` | `tenant_kaufnest.company_profile` | ⏳ **apply now** — adds `tax_id`/`phone`/`email`/`vat_rate`/`bank_name`/`iban`/`bic`/`invoice_prefix`/`payment_terms`/`footer_notes` columns (folds the old localStorage invoice settings into `company_profile`) |
| `migrations/008_platform_integrations.sql` | `tenant_kaufnest` | ⏳ **apply now** — adds `platform_connections` table (+ RLS, admin/super_admin-only including SELECT) and `sales.external_order_id` + unique `(platform, external_order_id)` index, for the Integrations feature (`src/lib/integrations/`) |
| `migrations/010_order_fees.sql` | `tenant_kaufnest.sales` | ⏳ **pending** (apply in Supabase SQL editor — Project B) — adds `shipping_cost`, `shipping_charged`, `advertising_fee` nullable `numeric(12,2)` columns with `>= 0` CHECKs; also baked into `provision_tenant_schema()` for future tenants. **Fixed 2026-08-03**: this file previously hardcoded `ALTER TABLE tenant_kaufnest.sales` instead of fanning out via `run_on_all_tenant_schemas` — the root cause of `tenant_testing` never getting these three columns. It now uses the fan-out helper (idempotent, safe to re-run) per the rule in `AGENTS.md`. |
| `migrations/011_pagination_indexes.sql` | `tenant_kaufnest.*` | ⏳ **pending** — 4 new indexes: `audit_logs (created_at desc, action, user_id)` and `products (name asc)` for efficient pagination range queries and filter queries |
| `migrations/012_tenant_migration_helper.sql` | `public` | ⏳ **apply first** — installs `public.run_on_all_tenant_schemas(sql text)` helper; **must be applied before any migration that uses it** |
| `migrations/013_backfill_all_tenants.sql` | all `tenant_%` schemas | ⏳ **apply second** — backfills migrations 004/007/008/010/011 to every live tenant using the helper; replaces the per-tenant ALTERs those files previously required |
| `migrations/014_company_profile_insert_policy.sql` | all `tenant_%` schemas | ⏳ **apply now** — adds missing INSERT RLS policy on `company_profile`; fixes "new row violates row-level security" error from Settings page `.upsert()` |
| `migrations/015_purchases_sale_id.sql` | all `tenant_%` schemas | ⏳ **apply now** — adds `sale_id uuid` FK + `idx_purchases_sale_id` index to `purchases`; links a cost-of-goods purchase to the triggering sale |
| `migrations/019_dropship_supplier_price.sql` | `tenant_kaufnest.dropship_listings` | ⏳ **pending** — creates `dropship_listings` table in `tenant_kaufnest` (platform-admin-only feature, not applied to all tenants), adds `supplier_price`/`supplier_currency`/`supplier_price_checked_at` columns, migrates legacy data from `public.dropship_listings`, sets up RLS policies |
| `migrations/020_dropship_customs_tax.sql` | `tenant_kaufnest.dropship_listings` | ⏳ **pending** — adds `customs_tax_amount NUMERIC(12,2) NOT NULL DEFAULT 3` (flat fee, not a rate/percentage — the `DEFAULT 3` backfills existing rows too), direct `ALTER TABLE` (documented KaufNest-only exception to the "2 places" rule, same as 019) |
| `migrations/021_ebay_listing_drafts.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `ebay_listing_drafts` table (draft eBay listings, sourced from Inventory or a third-party URL) via `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()`. Backs `src/app/dashboard/listings/` |
| `migrations/022_listing_images_bucket.sql` | Storage (Project B) | ⏳ **pending** — creates the `listing-images` Storage bucket + `public.current_tenant_role()` helper + tenant-path-scoped RLS policies (public read, admin/super_admin write/delete by tenant) |
| `migrations/023_user_permission_overrides.sql` | all `tenant_%` schemas | ⏳ **pending** — adds `profiles.permission_overrides` (jsonb array, additive per-user permission grants), `{{schema}}.current_user_has_override(perm)` function, and updates `sales_delete`/`expenses_delete`/`purchases_delete` RLS policies to also allow via override; also baked into `provision_tenant_schema()`. Backs the Users feature's Permissions modal |
| `migrations/024_dropship_listings_rls_tighten.sql` | `tenant_kaufnest.dropship_listings` | ⏳ **pending** — restricts SELECT/INSERT/UPDATE from any authenticated tenant member to admin/super_admin role (KaufNest-only direct `ALTER`, same exception as 019/020) |
| `migrations/025_user_status.sql` | all `tenant_%` schemas | ⏳ **pending** — adds `profiles.status` ('active'/'deactivated'); also baked into `provision_tenant_schema()`. Backs the Users feature's Deactivate/Reactivate action, enforced in `src/proxy.ts` |
| `migrations/026_ebay_messages.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `ebay_messages` table (synced eBay buyer messages, admin/super_admin-only RLS) via `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()`. Backs `src/app/dashboard/messages/` |
| `migrations/027_reconcile_tenant_drift.sql` | all `tenant_%` schemas | ⏳ **pending** — reconciles schema drift across all five live tenant schemas; replays missing objects (sales fee columns 010, purchases.sale_id + indexes 015, profiles.permission_overrides + current_user_has_override() function + delete policies 023, ebay_messages table + trigger + indexes + RLS 026) via `run_on_all_tenant_schemas`. All statements are idempotent. |
| `migrations/028_notifications.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `notifications` and `notification_reads` tables via `run_on_all_tenant_schemas` (one row per EVENT, visibility resolved per-reader by RLS policy); adds `profiles.notifications_read_through` column, 3 indexes, and grants (plus revoke of inherited default privileges for security). No insert/update/delete policy on `notifications` — only SECURITY DEFINER triggers in the next migration write there. Also baked into `provision_tenant_schema()`. Backs the Notifications feature — there is no `src/app/dashboard/notifications/` route; the UI is the `NotificationBell` in `src/components/layout/` plus `notificationsSlice`. |
| `migrations/029_notification_triggers.sql` | all `tenant_%` schemas | ⏳ **pending** — adds three SECURITY DEFINER trigger functions via `run_on_all_tenant_schemas` (`notify_sale_created`, `notify_purchase_created`, `notify_message_received`); write notification rows on insert into `sales`/`purchases`/`ebay_messages`; low stock is a READ-TIME state, not an event (see migration header comment for why). All functions have pinned `search_path = {{schema}}, public`, explicit 'super_admin' in `visible_to_roles` arrays (required by notification RLS), and exception-handled inserts so notifications never block core writes; idempotent with `DROP TRIGGER IF EXISTS` on each. Does NOT modify `apply_purchase_stock_change`/`apply_sale_stock_change` (002). Also baked into `provision_tenant_schema()`. Backs the Notifications feature. |
| `migrations/030_ebay_messages_override.sql` | all `tenant_%` schemas | ⏳ **pending — apply AFTER 027** (027 creates `ebay_messages` and the original `ebay_messages_all_admin` policy this redefines) — redefines `ebay_messages_all_admin` via `run_on_all_tenant_schemas` to OR in `current_user_has_override('manage_messages')` on both `using` and `with check`, idempotent via `drop policy if exists`. Fixes the dead-end click where a user granted the `manage_messages` override could see the `message.received` notification (029) but not read the `ebay_messages` row it pointed to. Also baked into `provision_tenant_schema()`. Backs `src/app/dashboard/messages/`. |
| `migrations/031_sales_refunded_amount.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `sales.refunded_amount numeric(12,2)` (`>= 0` CHECK) via `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()` in the same commit. Idempotency marker for the Amazon REFUND import path (later tasks): a sale whose `refunded_amount` is already set is skipped on re-import instead of being deducted twice — REFUND rows deduct from the sale they belong to rather than becoming their own row, since `sales_unit_price_check` rejects a negative `unit_price` and `idx_sales_platform_external_order_id` is a non-partial unique index on `(platform, external_order_id)`, which every refund shares with its own sale. Backs `src/app/dashboard/sales/`. |
| `control-plane/001_schema.sql` | `control` (Project A) | ✅ applied |
| `control-plane/002_grants.sql` | `control` (Project A) | ⏳ **apply now** — `service_role`/`sb_secret_*` needs explicit `USAGE`/table grants on `control` (CREATE SCHEMA grants nothing by default); fixes `42501 permission denied for schema control` on `createControlClient()` |
| `control-plane/003_add_admin_email.sql` | `control.tenants` (Project A) | ⏳ **apply now** — adds nullable `admin_email` column, shown in `/admin`'s tenants table |
| `control-plane/004_admin_audit_log.sql` | `control` (Project A) | ⏳ **pending** — creates `control.admin_audit_log`, written to by `/api/admin/impersonate` on every impersonation |

**`dropship_listings` is still missing from four of the five tenant
schemas** (`tenant_hochkauf`, `tenant_k2_textil`, `tenant_testing`,
`tenant_waqasmumtaz` — only `tenant_kaufnest` has it, via 019/020/024's
documented KaufNest-only exception to the 2-places rule). This is
**deliberately out of scope for the notifications branch** — reconciling it
would mean deciding whether dropshipping becomes a normal multi-tenant
feature or stays KaufNest-only, which risks the dropshipping feature itself
and needs its own task, not a drive-by fix here.

`tenant_kaufnest` already exists in Project B with all data migrated, RLS +
grants in place, and Phase 3 client routing verified (see
`SAAS_MIGRATION.md` Phase 2/3 checklists). With 005 applied, Phase 4 dynamic
provisioning (`/api/admin/provision-tenant`) is code-complete — see
`src/app/admin/SKILL.md`.

**The table above (not this paragraph) is the authoritative apply-status
list** — every migration marked ⏳ is outstanding, not just 004/007/008 (an
earlier version of this paragraph named only those three, which drifted out
of sync as later migrations were added; see AUDIT_2026-07-24.md §3.3). That
table is itself unverified against the live databases — this repo has no
migration ledger, so "applied" here reflects what *should* have been run,
not a confirmed live check. Confirm on the actual Project A/B databases
before treating any specific migration as safely skippable. All ⏳ entries
are additive/idempotent and safe to run anytime, in file-number order.

**Confirming apply-status is no longer guesswork** — `.mcp.json`'s
`supabase-data`/`supabase-control` servers (read-only) can query
`information_schema.columns`/`information_schema.tables` directly against
both live projects. E.g. to confirm migration 025 is applied to a given
tenant schema, check whether `<schema>.profiles` has a `status` column.
Prefer this over updating this table from memory/assumption.

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

## The "2 places" rule for schema changes

Any change to `sales`/`purchases`/`expenses`/`products`/etc. that should apply
to **every** tenant (existing and future) touches **exactly two places**:

1. **`provision_tenant_schema()`** in `005_tenant_provisioning.sql` — so every
   *future* tenant gets the change from schema creation.
2. **A new migration that calls `run_on_all_tenant_schemas`** — applies the
   same DDL to every already-provisioned `tenant_%` schema automatically:

```sql
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS my_col numeric(12,2) CHECK (my_col >= 0);
$$);
```

**Never write `ALTER TABLE tenant_kaufnest.*` directly in a new migration.**
With multiple live tenants (see the named list at the top of this file —
that's the source of truth; don't repeat a specific count here, it drifts),
hardcoding one schema name leaves all others stale.
`run_on_all_tenant_schemas` discovers every `tenant_%` schema at runtime, so
adding a new tenant (via `/api/admin/provision-tenant`) is automatically
included in all future migrations.

## Using `run_on_all_tenant_schemas`

Install once by applying `012_tenant_migration_helper.sql`. Then every
subsequent migration that touches tenant tables uses the helper:

```sql
-- Good — applies to all live tenants
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.company_profile
    ADD COLUMN IF NOT EXISTS new_field text;
  CREATE INDEX IF NOT EXISTS idx_{{schema}}_sales_new
    ON {{schema}}.sales (new_field);
$$);

-- Bad — only updates one tenant
ALTER TABLE tenant_kaufnest.company_profile ADD COLUMN IF NOT EXISTS new_field text;
```

**Rules for the SQL string you pass:**
- Use `{{schema}}` as the placeholder — substituted with the raw schema name
  (e.g. `tenant_kaufnest`), unquoted, so it works in both table references
  and object names (index names, trigger names).
- Every statement must be idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  `DROP … IF EXISTS`) — migrations can be re-run safely.
- For `CREATE TABLE` with FK references, use `{{schema}}.profiles(id)`.
- For RLS policy names: use `DROP POLICY IF EXISTS "…" ON {{schema}}.table`
  before `CREATE POLICY`, since `CREATE POLICY` has no `IF NOT EXISTS`.

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

- **`company_profile` needs an INSERT policy for upsert**: the settings page
  uses `.upsert()` which fires INSERT when no row exists. `company_profile`
  originally only had SELECT + UPDATE policies — the INSERT policy was missing,
  causing "new row violates row-level security". Fixed in
  `014_company_profile_insert_policy.sql` and baked into
  `provision_tenant_schema()`. Any table that accepts `.upsert()` from the
  client needs both UPDATE and INSERT policies.
- **`run_on_all_tenant_schemas` must exist before you call it**: apply
  `012_tenant_migration_helper.sql` first, then run any migration that uses
  it. If you paste both in one SQL editor session, put the function definition
  before the `SELECT … run_on_all_tenant_schemas(…)` call.
- **`run_on_all_tenant_schemas` only covers existing schemas**: it reads
  `information_schema.schemata` at call time. New tenants provisioned
  *after* the migration runs already get the change because it's baked into
  `provision_tenant_schema()` (place #1 of the 2-places rule). No manual
  follow-up is needed for new tenants.
- **`run_on_all_tenant_schemas` is `SECURITY DEFINER`**: it runs as the
  function owner (`postgres` / `supabase_admin`), which can ALTER tables in
  all tenant schemas. Do not use it for DML (INSERT/UPDATE/DELETE) — DDL only.
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
- **`notifications_select` (028) has NO automatic super_admin bypass.**
  Unlike some other tables in this schema, the policy is a flat
  `current_user_role() = any(visible_to_roles) OR (required_permission ...
  has_override)` — there is no `OR current_user_role() = 'super_admin'`
  fallback. Every trigger that inserts into `notifications` (029) must list
  `'super_admin'` in its own `visible_to_roles` array explicitly, or a
  platform owner sees nothing for that notification type. All three current
  triggers (`notify_sale_created`, `notify_purchase_created`,
  `notify_message_received`) do this correctly — check it again if you add a
  fourth.
- **Notification trigger inserts swallow ALL errors, silently.** Every
  function in `029_notification_triggers.sql` wraps its `insert into
  notifications` in `exception when others then null;`. This is deliberate —
  a broken notification write must never abort the `sales`/`purchases`/
  `ebay_messages` insert that triggered it — but it also means a
  misconfigured trigger (bad column, RLS regression, etc.) fails completely
  invisibly: no error in the client, no row in `notifications`, nothing in
  Postgres logs beyond what `get_logs` would show if you went looking. If
  notifications mysteriously stop appearing for one event type, check the
  trigger function directly (e.g. via `supabase-data`'s `get_logs`) rather
  than assuming the client-side code is at fault.
