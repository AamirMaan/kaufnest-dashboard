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

> **⚠️ VERIFIED LIVE 2026-08-27 (updated same day, later) — the per-row ⏳
> markers below are STALE.** Queried both projects read-only via MCP against
> `information_schema`/`pg_policies`/`pg_indexes`/`pg_constraint`, across all
> five tenant schemas (not just `tenant_kaufnest`). Result:
>
> - **Everything through `033` is applied**, 5/5 tenants — including 007, 008,
>   010, 015, 021, 023, 025, 026 (all 5/5), the `listing-images` bucket,
>   027–030's notifications stack + the `manage_messages` override branch on
>   `ebay_messages_all_admin`, `031_sales_refunded_amount.sql`,
>   `032_expenses_allow_negative_amount.sql`, and
>   `033_ebay_messages_full_unique_index.sql` (`idx_ebay_messages_external_id`
>   re-checked directly — genuinely non-partial in all 5 tenants now; it was
>   still the old partial index as of the first 2026-08-27 pass below).
> - **`005_tenant_provisioning.sql` is current in the repo** through 030's
>   override branch and 031/032's changes, PLUS a 2026-08-27 fix adding
>   `shipping_cost`/`shipping_charged`/`advertising_fee`/`platform_fee` to
>   its `sales` CREATE TABLE (they were missing there despite being live on
>   every tenant since `010`/`027` — see `035`'s row and the gotcha in
>   `dashboard/sales/SKILL.md`) — but the file being current in the repo is
>   NOT the same as the live `provision_tenant_schema()` function body being
>   up to date; that's only true once `005` is actually re-applied. Re-verify
>   before assuming it covers `033`/`034`/`035`.
> - **Genuinely outstanding: `034_ebay_messages_item_details.sql`** (added
>   2026-08-27, not yet applied), **`035_sales_platform_fee.sql`** (added
>   2026-08-27, not yet applied — also needs `005` re-applied for the fix
>   above to take effect for new tenants), and
>   **`control-plane/004_admin_audit_log.sql`** (`control.admin_audit_log`
>   does not exist). `control-plane/002` and `003` are applied.
>
> Do not trust a ⏳ marker below without re-checking; this repo still has no
> migration ledger, which is why they drifted. Re-verify and update this block
> rather than the individual rows until a ledger exists.

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
| `migrations/026_ebay_messages.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `ebay_messages` table (synced eBay buyer messages, admin/super_admin-only RLS) via `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()`. Backs `src/app/dashboard/messages/`. Its `idx_ebay_messages_external_id` was created PARTIAL (`WHERE external_message_id IS NOT NULL`) — superseded by `033`, see that row. |
| `migrations/027_reconcile_tenant_drift.sql` | all `tenant_%` schemas | ⏳ **pending** — reconciles schema drift across all five live tenant schemas; replays missing objects (sales fee columns 010, purchases.sale_id + indexes 015, profiles.permission_overrides + current_user_has_override() function + delete policies 023, ebay_messages table + trigger + indexes + RLS 026) via `run_on_all_tenant_schemas`. All statements are idempotent. |
| `migrations/028_notifications.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `notifications` and `notification_reads` tables via `run_on_all_tenant_schemas` (one row per EVENT, visibility resolved per-reader by RLS policy); adds `profiles.notifications_read_through` column, 3 indexes, and grants (plus revoke of inherited default privileges for security). No insert/update/delete policy on `notifications` — only SECURITY DEFINER triggers in the next migration write there. Also baked into `provision_tenant_schema()`. Backs the Notifications feature — there is no `src/app/dashboard/notifications/` route; the UI is the `NotificationBell` in `src/components/layout/` plus `notificationsSlice`. |
| `migrations/029_notification_triggers.sql` | all `tenant_%` schemas | ⏳ **pending** — adds three SECURITY DEFINER trigger functions via `run_on_all_tenant_schemas` (`notify_sale_created`, `notify_purchase_created`, `notify_message_received`); write notification rows on insert into `sales`/`purchases`/`ebay_messages`; low stock is a READ-TIME state, not an event (see migration header comment for why). All functions have pinned `search_path = {{schema}}, public`, explicit 'super_admin' in `visible_to_roles` arrays (required by notification RLS), and exception-handled inserts so notifications never block core writes; idempotent with `DROP TRIGGER IF EXISTS` on each. Does NOT modify `apply_purchase_stock_change`/`apply_sale_stock_change` (002). Also baked into `provision_tenant_schema()`. Backs the Notifications feature. |
| `migrations/030_ebay_messages_override.sql` | all `tenant_%` schemas | ⏳ **pending — apply AFTER 027** (027 creates `ebay_messages` and the original `ebay_messages_all_admin` policy this redefines) — redefines `ebay_messages_all_admin` via `run_on_all_tenant_schemas` to OR in `current_user_has_override('manage_messages')` on both `using` and `with check`, idempotent via `drop policy if exists`. Fixes the dead-end click where a user granted the `manage_messages` override could see the `message.received` notification (029) but not read the `ebay_messages` row it pointed to. Also baked into `provision_tenant_schema()`. Backs `src/app/dashboard/messages/`. |
| `migrations/031_sales_refunded_amount.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `sales.refunded_amount numeric(12,2)` (`>= 0` CHECK) via `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()` in the same commit. Idempotency marker for the Amazon REFUND import path (later tasks): a sale whose `refunded_amount` is already set is skipped on re-import instead of being deducted twice — REFUND rows deduct from the sale they belong to rather than becoming their own row, since `sales_unit_price_check` rejects a negative `unit_price` and `idx_sales_platform_external_order_id` is a non-partial unique index on `(platform, external_order_id)`, which every refund shares with its own sale. Backs `src/app/dashboard/sales/`. |
| `migrations/032_expenses_allow_negative_amount.sql` | all `tenant_%` schemas | ⏳ **pending** — drops `expenses_amount_check CHECK (amount >= 0)` via `run_on_all_tenant_schemas`, idempotent (`drop constraint if exists`); also mirrored into `provision_tenant_schema()` in the same commit (the `amount` column's `CHECK` removed, comment noting it may be negative). Lets the Expenses importer store German Vorsteuerkonto credit notes (`Erstattung von Verkäufergebühren`, `Tarifas reembolsadas`, `Återbetalda avgifter`) as negative `amount` rows instead of dropping them, so totals reconcile with the filed VAT return. `src/app/dashboard/page.tsx`'s Expenses-by-Category list colors a negative category total `--color-success` instead of `--color-danger`. Backs `src/app/dashboard/expenses/` (later tasks 5/6 depend on this). |
| `migrations/033_ebay_messages_full_unique_index.sql` | all `tenant_%` schemas | ✅ applied 5/5 (re-verified 2026-08-27) — drops and recreates `idx_ebay_messages_external_id` as a full (non-partial) unique index via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. The partial version (026) blocked `sync/route.ts`'s `.upsert(rows, { onConflict: "external_message_id" })` outright — Postgres won't infer a partial unique index for a plain `ON CONFLICT (col)` with no predicate, which is all Supabase's `.upsert()` can express, so every sync failed at the DB write with "no unique or exclusion constraint matching the ON CONFLICT specification" (42P10). Backs `src/app/dashboard/messages/`. |
| `migrations/034_ebay_messages_item_details.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `item_title`/`item_price`/`item_currency`/`item_url` to `ebay_messages` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. `GetMemberMessages`' `<Item>` block already carries this (confirmed live 2026-08-27) but the app discarded all of it, extracting only `<ItemID>`. Backs `src/app/dashboard/messages/`. |
| `migrations/035_sales_platform_fee.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `sales.platform_fee numeric(12,2)` (`>= 0` CHECK) via `run_on_all_tenant_schemas`. Also fixes `005_tenant_provisioning.sql`'s `sales` CREATE TABLE, which was missing `shipping_cost`/`shipping_charged`/`advertising_fee` too (confirmed live 2026-08-27 that all 5 tenants already had those three from `010`/`027` — only the `005` template itself was stale) — **applying `035` alone does not fix that gap for future tenants; `005` must be re-applied too**. Backs `src/app/dashboard/sales/` — see its SKILL.md's fee-fields gotcha. |
| `migrations/036_ebay_listing_drafts_merchant_location.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `merchant_location_key text` to `ebay_listing_drafts` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Replaces a single global `EBAY_MERCHANT_LOCATION_KEY` env var that only ever worked for one tenant's eBay account (seller-account-specific, confirmed broken live 2026-08-30) — now fetched live per-tenant (`fetchInventoryLocations`/`GET /api/listings/ebay/locations`) and chosen per-draft in the wizard, same pattern as the existing fulfillment/payment/return policy IDs. Backs `src/app/dashboard/listings/` — see its `SKILL.md` gotcha for the full story. |
| `migrations/037_ebay_listing_drafts_aspects.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable-by-default `aspects jsonb NOT NULL DEFAULT '{}'::jsonb` to `ebay_listing_drafts` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Stores the tenant's chosen values for whichever item aspects (e.g. Brand/"Marke") eBay's Taxonomy API says are required for a draft's category — confirmed live 2026-08-31 that `publishOffer` 400s (errorId 25002) one missing required aspect at a time, with no fixed list since it varies per category. Backs `src/app/dashboard/listings/` — see its `SKILL.md` gotcha for the full story. |
| `migrations/038_ebay_listing_drafts_origin.sql` | all `tenant_%` schemas | ⏳ **pending** — adds `origin text NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'ebay_import'))` to `ebay_listing_drafts`, plus a full (non-partial) unique index on `ebay_listing_id`, via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Distinguishes listings this app published from ones synced in from a tenant's existing eBay account (`POST /api/listings/ebay/sync`), so the UI knows whether a row opens the create wizard or the Trading-API live-edit page. The unique index is required for that sync route's `.upsert(rows, { onConflict: "ebay_listing_id" })` — deliberately non-partial, since a partial index breaks Supabase's `onConflict` inference (the same mistake `033_ebay_messages_full_unique_index.sql` fixed for a different table). Backs `src/app/dashboard/listings/` — see its `SKILL.md` gotcha on why the `origin="app"` exclusion on every sync/upsert is load-bearing. |
| `migrations/039_ebay_listing_drafts_inactive_status.sql` | all `tenant_%` schemas | ⏳ **pending — needs manual apply**, this session's `supabase-data` MCP connection is read-only for DDL (`ALTER TABLE` in a read-only transaction errored out; apply via the Supabase SQL editor or CLI instead). Drops and recreates `ebay_listing_drafts_status_check` to add `'inactive'` to the allowed `status` values, via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Backs `src/app/dashboard/listings/`'s switch from hard-deleting a local row once a listing ends on eBay to marking it `inactive` instead (end/sync/ebay-detail routes) — see its `SKILL.md` gotcha for the full story. |
| `migrations/040_sales_ebay_fulfillment.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `tracking_number`, `shipping_carrier`, `ebay_fulfillment_id`, `ebay_sync_error`, `ebay_synced_at` to `sales` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Backs the eBay order status push-back (piece 1/4 of the "eBay order fulfillment" decomposition): `POST /api/integrations/ebay/orders/[saleId]/sync-status` pushes a local "shipped"/"cancelled" status change on an eBay-sourced order out to eBay's Fulfillment API. Backs `src/app/dashboard/sales/` — see its `SKILL.md`. |
| `control-plane/001_schema.sql` | `control` (Project A) | ✅ applied |
| `control-plane/002_grants.sql` | `control` (Project A) | ⏳ **apply now** — `service_role`/`sb_secret_*` needs explicit `USAGE`/table grants on `control` (CREATE SCHEMA grants nothing by default); fixes `42501 permission denied for schema control` on `createControlClient()` |
| `control-plane/003_add_admin_email.sql` | `control.tenants` (Project A) | ⏳ **apply now** — adds nullable `admin_email` column, shown in `/admin`'s tenants table |
| `control-plane/005_tenants_admin_email_unique.sql` | `control.tenants` (Project A) | ⏳ **pending** — unique index on `admin_email`; the idempotency lock for self-serve signup's provisioning route, which claims its tenant row before doing expensive work so a refresh or concurrent request collides (23505) instead of creating a second schema. Plain (non-partial) index: Postgres treats multiple NULLs as distinct, so existing rows without an `admin_email` are unaffected. Verified live 2026-08-28 — no duplicate non-null values, applies cleanly. |
| `control-plane/004_admin_audit_log.sql` | `control` (Project A) | ⏳ **pending** — creates `control.admin_audit_log`, written to by `/api/admin/impersonate` on every impersonation |
| `control-plane/006_tenants_provisioning_status.sql` | `control.tenants` (Project A) | ⏳ **apply now — this is a live production bug**, needs manual apply (Supabase SQL editor), this session's `supabase-control` MCP connection is read-only for DDL. Adds `'provisioning'` to the live-but-untracked `tenants_status_check` CHECK constraint (currently `'invited'/'active'/'deactivated'` only — confirmed via `pg_get_constraintdef` 2026-09-01). Every self-serve trial signup has been failing at `/api/signup/provision`'s very first insert (`new row for relation "tenants" violates check constraint "tenants_status_check"`) since whoever added this constraint did so directly against the live DB, outside any migration file, without including `'provisioning'` — see `005`'s own header comment, which correctly documented the constraint's ABSENCE as of 2026-08-28. |
| `control-plane/007_tenant_ai_usage.sql` | Project A | ⏳ **apply now** — adds `control.tenants.ai_enabled` (default true) + `control.tenant_ai_usage` (per-tenant, per-user, per-month AI call/token counters, RLS enabled). Backs the Listing Studio AI features; quota constant lives in `lib/utils/planGating.ts` (`aiGenerationsPerMonth`). |
| `control-plane/008_ai_usage_atomic_increment.sql` | Project A | ⏳ **apply now** — creates `control.record_ai_usage(...)`, a SECURITY DEFINER `INSERT ... ON CONFLICT DO UPDATE` that increments a `control.tenant_ai_usage` row atomically and returns the new `calls`. `recordUsage()` (`src/lib/ai/quota.ts`) calls it instead of the old read-then-upsert, which lost increments under ordinary concurrency (a double-clicked AI button billed N Anthropic calls but moved the meter by one). Requires `007` first. |
| `control-plane/009_tenants_referral.sql` | `control.tenants` (Project A) | ✅ **applied** — adds nullable `referral` text column, free-text attribution for who referred this tenant (captured at self-serve signup via `?ref=`, or set later by a platform admin), so the business can identify and pay a referral share manually. No format enforcement, no relationship to `plan`/Stripe. See `docs/superpowers/specs/2026-09-04-tenant-referral-attribution-design.md`. |

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
