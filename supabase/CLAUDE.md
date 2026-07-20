# Supabase SQL (`supabase/`)

SQL migrations for the two Supabase projects behind the SaaS multi-tenant
setup. **Read `SKILL.md` first** — it has the file map with apply-status, the
apply order, the index rationale, and the gotchas (PostgREST grants, exposed
schemas, JWT refresh, RLS helper functions, `CREATE INDEX CONCURRENTLY`).

## Files

- `control-plane/001_schema.sql` — Project A (`control` schema): `control.tenants`,
  `control.admin_users`, seed admin, plus the `tenant_kaufnest` registration row.
- `control-plane/002_grants.sql` — `GRANT USAGE`/table privileges on `control`
  for `service_role`, missing from 001 (`CREATE SCHEMA` grants nothing by
  default). Apply this if `createControlClient()` calls (`/admin`,
  `/api/admin/*`) fail with `42501 permission denied for schema control`.
- `control-plane/003_add_admin_email.sql` — adds nullable
  `control.tenants.admin_email`, populated by `/api/admin/provision-tenant`
  and shown in `/admin`'s tenants table.
- `migrations/001_init.sql` — Project B baseline: `public` tables, enums, RLS,
  `current_user_role()`, `handle_new_user()`, indexes.
- `migrations/002_inventory_and_vat.sql` — `public.products`, VAT columns,
  stock-sync triggers.
- `migrations/003_add_order_status.sql` — `public.sales` order `status`/`restock`
  + return-aware stock trigger.
- `migrations/004_performance_indexes.sql` — growth indexes for
  `tenant_kaufnest.sales/purchases/expenses`.
- `migrations/005_tenant_provisioning.sql` — canonical
  `public.provision_tenant_schema(schema_name)` + `public.set_user_tenant()`,
  used by Phase 4 dynamic tenant provisioning
  (`src/app/api/admin/provision-tenant/route.ts`).
- `migrations/006_bootstrap_tenant_kaufnest.sql` — historical record of how
  `tenant_kaufnest` was provisioned + seeded from `public.*`. Do not re-run.
- `migrations/007_company_profile_invoice_fields.sql` — adds invoice/banking/
  contact columns to `tenant_kaufnest.company_profile` (folds the old
  localStorage-only invoice settings into the per-tenant profile row); also
  baked into `provision_tenant_schema()` for future tenants.
- `migrations/008_platform_integrations.sql` — adds `platform_connections`
  (eBay/Amazon OAuth connection state, RLS admin/super_admin-only including
  SELECT) and `sales.external_order_id` + unique `(platform,
  external_order_id)` index to `tenant_kaufnest`; also baked into
  `provision_tenant_schema()` for future tenants. Backs the Integrations
  feature (`src/app/dashboard/integrations/`, `src/lib/integrations/`).
- `migrations/010_order_fees.sql` — adds `shipping_cost`, `shipping_charged`,
  `advertising_fee` nullable `numeric(12,2)` columns (all `>= 0` checked) to
  `tenant_kaufnest.sales`; also baked into `provision_tenant_schema()` for
  future tenants. Backs the order fee UI in later tasks.
- `migrations/012_tenant_migration_helper.sql` — installs
  `public.run_on_all_tenant_schemas(sql text)`. **Apply this before any
  migration that uses it.** All future tenant-schema migrations must call
  this instead of writing `ALTER TABLE tenant_kaufnest.*` directly — see
  `SKILL.md` for the 2-places rule and usage examples.
- `migrations/013_backfill_all_tenants.sql` — applies migrations 004, 007,
  008, 010, and 011 to all live tenant schemas at once via the helper.
  Requires 012 to be applied first. All statements are idempotent.
- `migrations/019_dropship_supplier_price.sql` — creates
  `tenant_kaufnest.dropship_listings` table (platform-admin-only feature),
  adds supplier price tracking columns, migrates legacy data from
  `public.dropship_listings`, sets up RLS policies. Direct `ALTER TABLE`
  (not via `run_on_all_tenant_schemas` — this table is KaufNest-only).
- `migrations/020_dropship_customs_tax.sql` — adds `customs_tax_amount`
  (`NUMERIC(12,2) NOT NULL DEFAULT 3`, a flat EU customs handling fee, not
  a percentage) to `tenant_kaufnest.dropship_listings` directly (not via
  `run_on_all_tenant_schemas` — this table is KaufNest-only, same documented
  exception as `019_dropship_supplier_price.sql`). The `DEFAULT 3` also
  backfills every existing row. Backs the margin-coloring UI in
  `src/app/dashboard/dropshipping/`.
- `migrations/021_ebay_listing_drafts.sql` — creates `ebay_listing_drafts` in
  every tenant schema via `run_on_all_tenant_schemas` (also baked into
  `provision_tenant_schema()`). Backs the Listings feature
  (`src/app/dashboard/listings/`, `src/lib/integrations/ebay/publish.ts`).
- `migrations/022_listing_images_bucket.sql` — creates the `listing-images`
  Storage bucket and its tenant-path-scoped RLS policies (first Storage
  bucket in this codebase — see its own header comment for the
  `current_tenant_role()` helper it introduces).

## Related code

- `src/lib/supabase/{client,server,control}.ts` + their `SKILL.md` — the
  schema-aware Supabase clients these migrations support.
- `src/app/api/admin/provision-tenant/route.ts` — calls
  `provision_tenant_schema` via RPC for new tenants.
- `src/lib/integrations/` + `src/app/dashboard/integrations/` — read/write
  `platform_connections` and `sales.external_order_id` from migration 008.
- `SAAS_MIGRATION.md` — the full migration narrative/checklist.
