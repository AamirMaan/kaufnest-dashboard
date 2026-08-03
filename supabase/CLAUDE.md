# Supabase SQL (`supabase/`)

SQL migrations for the two Supabase projects behind the SaaS multi-tenant
setup. **Read `SKILL.md` first** — it has the file map with apply-status, the
apply order, the index rationale, and the gotchas (PostgREST grants, exposed
schemas, JWT refresh, RLS helper functions, `CREATE INDEX CONCURRENTLY`).

## Files

- `_archive/` — superseded migrations kept for historical reference only,
  never apply these. `_archive/009_dropship_listings.sql` (moved here from
  `supabase/009_dropship_listings.sql` — its "9" collided with
  `migrations/009_tenant_status_rename.sql`, a foot-gun for anyone applying
  migrations by globbing the tree) created `dropship_listings` in the wrong
  schema (`public`); superseded by `migrations/019_dropship_supplier_price.sql`.
- `control-plane/001_schema.sql` — Project A (`control` schema): `control.tenants`,
  `control.admin_users`, seed admin, plus the `tenant_kaufnest` registration row.
- `control-plane/002_grants.sql` — `GRANT USAGE`/table privileges on `control`
  for `service_role`, missing from 001 (`CREATE SCHEMA` grants nothing by
  default). Apply this if `createControlClient()` calls (`/admin`,
  `/api/admin/*`) fail with `42501 permission denied for schema control`.
- `control-plane/003_add_admin_email.sql` — adds nullable
  `control.tenants.admin_email`, populated by `/api/admin/provision-tenant`
  and shown in `/admin`'s tenants table.
- `control-plane/004_admin_audit_log.sql` — creates `control.admin_audit_log`
  (admin_email, action, tenant_id, metadata, created_at). Written to by
  `/api/admin/impersonate` on every impersonation; not yet used by any other
  admin action.
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
- `migrations/023_user_permission_overrides.sql` — adds
  `profiles.permission_overrides` (jsonb array of `Permission` keys,
  additive-only per-user grants beyond role defaults) to every tenant schema
  via `run_on_all_tenant_schemas`; also adds the
  `{{schema}}.current_user_has_override(perm)` SQL function and updates the
  `sales_delete`/`expenses_delete`/`purchases_delete` RLS policies to OR in
  that check (those three DELETE policies were role-only, not
  app-code-gated). Also baked into `provision_tenant_schema()`. Backs the
  Users feature's Permissions modal
  (`src/app/dashboard/users/_components/PermissionsModal.tsx`).
- `migrations/024_dropship_listings_rls_tighten.sql` — tightens
  `tenant_kaufnest.dropship_listings` SELECT/INSERT/UPDATE RLS from "any
  authenticated tenant member" to tenant role admin/super_admin (direct
  `ALTER`, same KaufNest-only exception as 019/020 — this table isn't
  provisioned for other tenants). See AUDIT_2026-07-24.md §2.5 — can't check
  true platform-admin status here since `control.admin_users` lives in a
  different Supabase project than this table.
- `migrations/025_user_status.sql` — adds `profiles.status` ('active' |
  'deactivated', default 'active') to every tenant schema via
  `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()`.
  Deliberately not a delete — see the migration's header comment for why.
  Backs the Users feature's Deactivate/Reactivate action
  (`src/app/dashboard/users/page.tsx`), enforced in `src/proxy.ts`.
- `migrations/026_ebay_messages.sql` — creates `ebay_messages` in every
  tenant schema via `run_on_all_tenant_schemas` (also baked into
  `provision_tenant_schema()`); admin/super_admin-only RLS, same bar as
  `ebay_listing_drafts`. Backs the Messages feature
  (`src/app/dashboard/messages/`, `src/lib/integrations/ebay/messages.ts`).
- `migrations/027_reconcile_tenant_drift.sql` — reconciles schema drift across
  all five live tenant schemas (tenant_kaufnest, tenant_hochkauf, tenant_k2_textil,
  tenant_testing, tenant_waqasmumtaz); replays missing objects idempotently via
  `run_on_all_tenant_schemas`. Covers: sales fee columns (010), purchases.sale_id +
  indexes (015), profiles.permission_overrides + current_user_has_override() function
  + delete policies (023), ebay_messages table + trigger + indexes + RLS (026).
- `migrations/028_notifications.sql` — creates `notifications` and
  `notification_reads` tables in every tenant schema via `run_on_all_tenant_schemas`
  (one row per EVENT, visibility resolved per-reader by RLS policy; no
  insert/update/delete policy on `notifications` — only SECURITY DEFINER triggers
  in the next migration write there); adds `profiles.notifications_read_through`
  column; includes 3 indexes and explicit revoke of inherited default privileges.
  Baking into `provision_tenant_schema()` is a separate later task. Backs the
  Notifications feature.
- `migrations/029_notification_triggers.sql` — adds four SECURITY DEFINER trigger
  functions in every tenant schema via `run_on_all_tenant_schemas`:
  `notify_sale_created`, `notify_purchase_created`, `notify_low_stock`,
  `notify_message_received` — write notification rows on insert into
  `sales`/`purchases`/`ebay_messages` and on product low-stock downward crossing;
  all functions have pinned `search_path = {{schema}}, public` and explicit
  'super_admin' in `visible_to_roles` arrays (required by notification RLS policy);
  all statements idempotent. Does NOT modify `apply_purchase_stock_change`/
  `apply_sale_stock_change` (002). Backs the Notifications feature.

## Related code

- `src/lib/supabase/{client,server,control}.ts` + their `SKILL.md` — the
  schema-aware Supabase clients these migrations support.
- `src/app/api/admin/provision-tenant/route.ts` — calls
  `provision_tenant_schema` via RPC for new tenants.
- `src/lib/integrations/` + `src/app/dashboard/integrations/` — read/write
  `platform_connections` and `sales.external_order_id` from migration 008.
- `SAAS_MIGRATION.md` — the full migration narrative/checklist.
