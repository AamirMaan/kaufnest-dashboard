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
- `control-plane/005_tenants_admin_email_unique.sql` — unique index on
  `control.tenants.admin_email` — the idempotency lock for self-serve
  signup's provisioning route (`/api/signup/provision`), which claims its
  tenant row before doing expensive work so a refresh or concurrent request
  collides (23505) instead of creating a second schema.
- `control-plane/006_tenants_provisioning_status.sql` — adds `'provisioning'`
  to `control.tenants.status`'s CHECK constraint (`tenants_status_check`).
  Root cause of self-serve trial signup being completely broken (confirmed
  live 2026-09-01): this constraint exists live, allowing only
  `'invited'/'active'/'deactivated'`, but was never tracked in any migration
  file here — `005`'s own header comment explicitly (and, at the time,
  correctly) documented "No CHECK constraint exists on
  `control.tenants.status`", based on `001_schema.sql`'s plain `text not
  null default 'active'` column. Someone added this constraint directly
  against the live database afterward, outside any tracked migration,
  without including `'provisioning'` — the status `/api/signup/provision`
  has always written to its claim row first (see that route's own
  comments). Every self-serve trial signup failed at that very first insert
  until this was applied. See `(auth)/CLAUDE.md`/`SKILL.md` for the
  signup→provision→welcome flow this backs.
- `control-plane/007_tenant_ai_usage.sql` — adds `control.tenants.ai_enabled`
  (default true, the platform-admin AI revoke switch) and creates
  `control.tenant_ai_usage` (per-tenant, per-user, per-month AI call and
  token counters, RLS enabled). Backs the Listing Studio AI features.
- `control-plane/008_ai_usage_atomic_increment.sql` — creates
  `control.record_ai_usage(...)`, a SECURITY DEFINER
  `INSERT ... ON CONFLICT DO UPDATE` that bumps one `tenant_ai_usage` row in
  a single statement and returns the new `calls`. Replaces the read-then-
  upsert in `recordUsage()` (`src/lib/ai/quota.ts`), which lost increments
  under ordinary concurrency — N concurrent AI calls all read the same
  `calls` and all wrote `calls + 1`, so the tenant was billed N times and
  metered once. Requires `007`.
- `control-plane/009_tenants_referral.sql` — adds nullable
  `control.tenants.referral` text column — free-text attribution for who
  referred a tenant (a `?ref=` URL param at self-serve signup, or set later
  by a platform admin), so the business can identify and pay a referral
  share manually. No format enforcement, no relationship to `plan`/Stripe.
  See `docs/superpowers/specs/2026-09-04-tenant-referral-attribution-design.md`.
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
  (`src/app/api/admin/provision-tenant/route.ts`). `provision_tenant_schema()`
  now also provisions the notifications stack (028/029) for every new
  tenant: `notifications`/`notification_reads` tables,
  `profiles.notifications_read_through`, their RLS policies and indexes, the
  `authenticated`-only grants plus the `notifications` insert/update/delete
  revoke, and the three `notify_sale_created`/`notify_purchase_created`/
  `notify_message_received` SECURITY DEFINER trigger functions + triggers.
  Its `ebay_messages_all_admin` policy also already includes 030's
  `OR current_user_has_override('manage_messages')` branch, so newly
  provisioned tenants don't need 030 replayed separately.
  The notification-specific grant/revoke is executed after the function's
  blanket schema-wide `GRANT ... ON ALL TABLES` (section 7) so the revoke
  isn't immediately undone by it. **Re-applied to Project B — verified live
  2026-08-06**: the live function body contains `notifications`,
  `notification_reads` and 030's `manage_messages` override branch. It does
  **not** yet contain `refunded_amount`, so it needs one more re-apply
  alongside `031`; until then a newly provisioned tenant gets every table
  except that column. See `SKILL.md`'s file map for the full verified status.
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
  Also baked into `provision_tenant_schema()`. Backs the
  Notifications feature.
- `migrations/029_notification_triggers.sql` — adds three SECURITY DEFINER trigger
  functions in every tenant schema via `run_on_all_tenant_schemas`:
  `notify_sale_created`, `notify_purchase_created`, `notify_message_received` —
  write notification rows on insert into `sales`/`purchases`/`ebay_messages`;
  low stock is a READ-TIME state, not a triggered event (see migration header
  comment for why — short answer: sale edits via revert-then-reapply falsely
  fire crossing conditions). All functions have pinned `search_path = {{schema}}, public`,
  explicit 'super_admin' in `visible_to_roles` arrays (required by notification RLS),
  and exception-handled inserts so notification failures never block core writes;
  all statements idempotent. Does NOT modify `apply_purchase_stock_change`/
  `apply_sale_stock_change` (002). Also baked into `provision_tenant_schema()`.
  Backs the Notifications feature.
- `migrations/030_ebay_messages_override.sql` — redefines
  `ebay_messages_all_admin` in every tenant schema via
  `run_on_all_tenant_schemas`, adding an
  `OR current_user_has_override('manage_messages')` branch to both `using`
  and `with check` (idempotent via `drop policy if exists`). **Requires 027
  first** (027 is what creates `ebay_messages` and the original policy).
  Fixes the dead-end click documented in migration 029's header and
  `src/app/dashboard/messages/SKILL.md`: a user granted the
  `manage_messages` permission override could see the `message.received`
  notification (029) but the table's RLS had no override branch, so they
  couldn't read the row it pointed to. Also baked into
  `provision_tenant_schema()` (`005_tenant_provisioning.sql`) for new
  tenants. Backs the Messages feature
  (`src/app/dashboard/messages/`).
- `migrations/031_sales_refunded_amount.sql` — adds nullable
  `sales.refunded_amount numeric(12,2)` (`>= 0` CHECK) to every tenant schema
  via `run_on_all_tenant_schemas`; **also baked into
  `provision_tenant_schema()` (`005_tenant_provisioning.sql`) in the same
  commit**. This is the idempotency marker for the upcoming Amazon REFUND
  import rework: a sale whose `refunded_amount` is already set is skipped on
  re-import rather than deducted a second time. REFUND rows deduct from the
  sale they belong to instead of becoming their own row, because
  `sales_unit_price_check` rejects a negative `unit_price` and
  `idx_sales_platform_external_order_id` is a non-partial unique index on
  `(platform, external_order_id)` that every refund shares with its own
  sale. `Sale.refunded_amount` and the `SaleImportData` exclusion live in
  `src/types/index.ts` / `src/app/dashboard/sales/_components/importFormats.ts`;
  `"refunded"` was also added to `ORDER_STATUSES`
  (`src/app/dashboard/sales/_components/orderStatus.ts`) and to the
  `StatusBadge` variant map (`src/components/ui/Badge.tsx`, `warning` — it
  still counts as revenue at its reduced value, unlike `returned`). Backs
  the Sales feature (`src/app/dashboard/sales/`).
- `migrations/032_expenses_allow_negative_amount.sql` — drops
  `expenses_amount_check CHECK (amount >= 0)` from `expenses` in every
  tenant schema via `run_on_all_tenant_schemas` (idempotent, `drop
  constraint if exists`); **`provision_tenant_schema()`
  (`005_tenant_provisioning.sql`) was updated in the same commit** — the
  `amount` column's `CHECK` removed, with a trailing comment noting it may
  be negative. Lets the Expenses importer store German Vorsteuerkonto
  credit notes ("Erstattung von Verkäufergebühren", "Tarifas reembolsadas",
  "Återbetalda avgifter") as negative `amount` rows instead of dropping
  them, so dashboard totals reconcile with the filed VAT return.
  `src/app/dashboard/page.tsx`'s Expenses-by-Category list colors a
  negative category total `--color-success` instead of `--color-danger`.
  Backs the Expenses feature (`src/app/dashboard/expenses/`).
- `migrations/033_ebay_messages_full_unique_index.sql` — drops and recreates
  `idx_ebay_messages_external_id` (from `026_ebay_messages.sql`) as a full
  (non-partial) unique index via `run_on_all_tenant_schemas`; also mirrored
  into `provision_tenant_schema()` in the same commit. `026` made it
  PARTIAL (`WHERE external_message_id IS NOT NULL`) to let locally-created
  outbound rows coexist — unnecessary, since Postgres never treats two
  `NULL`s as conflicting under a plain `UNIQUE` index either — and it broke
  `sync/route.ts`'s `.upsert(rows, { onConflict: "external_message_id" })`:
  Postgres will not infer a partial unique index for a plain
  `ON CONFLICT (col)` with no predicate, which is all Supabase's `.upsert()`
  can express, so every real sync failed at the DB write with "no unique or
  exclusion constraint matching the ON CONFLICT specification" (42P10) —
  confirmed live 2026-08-27 across all 5 tenants (identical partial index in
  each, table empty in each, so converting had zero duplicate-data risk).
  Backs the Messages feature (`src/app/dashboard/messages/`).
- `migrations/034_ebay_messages_item_details.sql` — adds nullable
  `item_title text`, `item_price numeric(12,2)`, `item_currency text`,
  `item_url text` to `ebay_messages` via `run_on_all_tenant_schemas`; also
  mirrored into `provision_tenant_schema()` in the same commit.
  `GetMemberMessages`' `<Item>` block already carries `Title`,
  `SellingStatus`/`CurrentPrice` (with a `currencyID` attribute, same
  `MoneyType` shape `listings.ts` already parses for `GetMyeBaySelling`),
  and `ViewItemURL` — confirmed live 2026-08-27 — but the app was
  discarding all of it, extracting only `<ItemID>`, so the Messages UI
  could show nothing better than a bare numeric item id. Denormalized onto
  every message row rather than a separate items table, matching how
  eBay's own response already repeats the same `<Item>` block on every
  message about that item. `src/app/api/messages/[id]/reply/route.ts`'s
  insert copies these four fields from the original message, same as it
  already does for `item_id`/`buyer_username` — see the gotcha in
  `dashboard/messages/SKILL.md` for why. Backs the Messages feature.
- `migrations/035_sales_platform_fee.sql` — adds nullable `platform_fee
  numeric(12,2)` to `sales` via `run_on_all_tenant_schemas`. Also fixes a
  real, still-live gap found while adding it: `005_tenant_provisioning.sql`'s
  `sales` CREATE TABLE never had `shipping_cost`/`shipping_charged`/
  `advertising_fee` either, even though `010_order_fees.sql` (via
  `027_reconcile_tenant_drift.sql`, which fixed `010`'s own original
  hardcoded-`tenant_kaufnest` bug) put all three live on every existing
  tenant — nobody updated `005`'s template alongside either fix. `005` is
  fixed in the same commit to include all four fee columns, so a tenant
  provisioned from now on gets them from day one instead of silently
  missing them until the next drift-reconciliation pass. Backs the Sales
  feature (`src/app/dashboard/sales/`) — see its SKILL.md's fee-fields
  gotcha for the full story.
- `migrations/036_ebay_listing_drafts_merchant_location.sql` — adds nullable
  `merchant_location_key text` to `ebay_listing_drafts` via
  `run_on_all_tenant_schemas`; also mirrored into
  `provision_tenant_schema()` in the same commit. Replaces a single global
  `EBAY_MERCHANT_LOCATION_KEY` env var that only ever worked for one
  tenant's eBay account (seller-account-specific, confirmed broken live
  2026-08-30) — now fetched live per-tenant
  (`fetchInventoryLocations`/`GET /api/listings/ebay/locations`) and chosen
  per-draft in the wizard, same pattern as the existing fulfillment/payment/
  return policy IDs. Backs the Listings feature
  (`src/app/dashboard/listings/`) — see its `SKILL.md` gotcha for the full
  story.
- `migrations/037_ebay_listing_drafts_aspects.sql` — adds nullable-by-default
  `aspects jsonb NOT NULL DEFAULT '{}'::jsonb` to `ebay_listing_drafts` via
  `run_on_all_tenant_schemas`; also mirrored into
  `provision_tenant_schema()` in the same commit. Stores the tenant's chosen
  values for whichever item aspects (e.g. Brand/"Marke") eBay's Taxonomy API
  says are required for a draft's category — confirmed live 2026-08-31 that
  `publishOffer` 400s (errorId 25002) one missing required aspect at a time,
  with no fixed list since it varies per category. Backs the Listings
  feature (`src/app/dashboard/listings/`) — see its `SKILL.md` gotcha for
  the full story.
- `migrations/038_ebay_listing_drafts_origin.sql` — adds `origin text NOT
  NULL DEFAULT 'app' CHECK (origin IN ('app', 'ebay_import'))` to
  `ebay_listing_drafts`, plus a full (non-partial) unique index on
  `ebay_listing_id`, via `run_on_all_tenant_schemas`; also mirrored into
  `provision_tenant_schema()` in the same commit. Distinguishes listings
  this app published from ones synced in from a tenant's existing eBay
  account (`POST /api/listings/ebay/sync`). Backs the Listings feature
  (`src/app/dashboard/listings/`) — see its `SKILL.md` gotcha for the full
  story.
- `migrations/039_ebay_listing_drafts_inactive_status.sql` — drops and
  recreates `ebay_listing_drafts_status_check` to add `'inactive'` to the
  allowed `status` values, via `run_on_all_tenant_schemas`; also mirrored
  into `provision_tenant_schema()` in the same commit. Backs the switch
  (2026-09-01) from hard-deleting a local `ebay_listing_drafts` row once a
  listing ends on eBay to marking it `inactive` instead — a tenant deleting
  a listing, or eBay ending one behind their back, now stays visible as
  history under the Listings page's "Inactive" filter. Backs the Listings
  feature (`src/app/dashboard/listings/`) — see its `SKILL.md` gotcha for
  the full story.
- `migrations/040_sales_ebay_fulfillment.sql` — adds nullable
  `tracking_number`, `shipping_carrier`, `ebay_fulfillment_id`,
  `ebay_sync_error`, `ebay_synced_at` to `sales` in every tenant schema via
  `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()`
  in the same commit. Backs the eBay order status push-back (piece 1/4 of
  the "eBay order fulfillment" decomposition) — pushing a local
  "shipped"/"cancelled" `sales.status` change on an eBay-sourced order out
  to eBay's Fulfillment API via
  `POST /api/integrations/ebay/orders/[saleId]/sync-status`. Backs the Sales
  feature (`src/app/dashboard/sales/`).

## Related code

- `src/lib/supabase/{client,server,control}.ts` + their `SKILL.md` — the
  schema-aware Supabase clients these migrations support.
- `src/app/api/admin/provision-tenant/route.ts` and
  `src/app/api/signup/provision/route.ts` (2026-08-28, self-serve signup) —
  both call `provision_tenant_schema` and `addExposedSchema` for new tenants.
- `src/lib/integrations/` + `src/app/dashboard/integrations/` — read/write
  `platform_connections` and `sales.external_order_id` from migration 008.
- `SAAS_MIGRATION.md` — the full migration narrative/checklist.
