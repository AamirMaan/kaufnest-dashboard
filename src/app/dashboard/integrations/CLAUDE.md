# Integrations feature

Route: `/dashboard/integrations`. Lets a tenant connect their eBay and/or
Amazon seller accounts via OAuth; orders from connected platforms are reviewed
and imported manually via `/dashboard/integrations/review` and stored as
`sales` ("Orders") rows. Available only on the **Pro**/**Business** plans
(`hasPlatformIntegrations`) and manageable only by a user with
`can("integrations", 2)` (`useAccess()`, Task 5 — `accountant`'s role
default is 0, so only admin/super_admin see management controls unless a
tenant admin grants an exception via the Users feature).

## Files in this folder

- `page.tsx` — `"use client"`. Default export wraps `IntegrationsContent` in
  `<Suspense fallback={null}>` (required because it reads `useSearchParams()`
  for the `connected=`/`error=` query params set by the OAuth callback route
  and shows a `Toast` for each). Reads `ent`/`availability` from `usePlan()`
  and `connections` from `state.integrations.connections`. `canManage =
  can("integrations", 2)` via `useAccess()` (Task 5 — replaced
  `hasPermission(role, "manage_integrations")`). Three render branches, in
  order:
  1. `!ent || !hasPlatformIntegrations(ent)` → upgrade-prompt
     card linking to `/dashboard/settings`.
  2. `!canManage` → "contact your admin" message.
  3. Otherwise → plan-limit and legacy-eBay "reconnect once" banners, then one
     `<PlatformAccountsSection>` per `IntegrationPlatform` (`["ebay", "amazon"]`).
     `error=` codes from the callback go through `integrationErrorMessage`.
- `_components/PlatformAccountsSection.tsx` — one platform's section: heading
  (`platformHeading`: used/cap), "Add {label} account" button (disabled by
  `canAddAccount`; full navigation to `/api/integrations/{platform}/connect`),
  upgrade hint at the cap, empty state, and a grid of `ConnectionCard`s.
- `_components/ConnectionCard.tsx` — ONE account: `display_name ?? label`,
  username subline, state `Badge` (`AccountState` from `accountState`), last
  synced/error. `canManage`: inline rename form (PATCH `display_name`),
  Pause/Resume (PATCH `is_active`; Resume disabled when `!canResume`), Review
  orders link, eBay-only "Sync eBay charges" button (active accounts; POSTs
  `{ connectionId }` to `/api/integrations/ebay/charges/sync`, toasts
  `_lib/chargeSyncSummary.ts`'s text or the mapped error), **super_admin-only**
  "Overwrite fees from eBay" (active eBay accounts; `canOverwriteEbayFees` from
  `lib/utils/feeOverwriteAccess.ts` on `currentUser.profile.role`; mounts
  `FeeOverwriteModal` only while open), Disconnect via `DeleteConfirmModal` (POST `{ connectionId }`;
  dispatches `setConnectionStatus`), and Reconnect
  (`/connect?reconnect=<id>`, skips the connect-time cap check) on
  disconnected, error-state and legacy (no `external_account_id`) rows. PATCH success
  dispatches `upsertConnection`.
- `_lib/accountSummary.ts` (+ test) — pure `platformHeading` (used by
  `PlatformAccountsSection`) and `needsReconnectBanner` (used by `page.tsx`
  and by `PlatformAccountsSection` to disable "Add account" while a legacy
  eBay row is pending).
- `_lib/chargeSyncSummary.ts` (+ test) — pure `chargeSyncSummary(counts)`:
  the "Sync eBay charges" toast text — one sentence (new expenses, orders
  that got fees, refund fee credits when > 0) plus "Not applied: …" listing
  only the non-zero skip counters (`orderLinkedUnmatched` reads "orders not
  imported yet"). Declares its own `ChargeSyncCounts` type so the client
  never imports the server-only `chargeSync.ts`.
- `_components/FeeOverwriteModal.tsx` (2026-10-21) — the eBay fee overwrite
  review: POSTs `/api/integrations/ebay/fees/preview` on open ("Checking
  eBay…" spinner), shows one `DataTable` row per order line with Platform/Ad
  Fee as `current → eBay` (all rows start ticked; "—" = that fee isn't
  changing), the skip note, then "Apply N order lines" POSTs
  `/api/integrations/ebay/fees/apply` in batches of `APPLY_BATCH_ROWS` rows
  (≤ the route's change cap). The toast counts fees and order lines (`applySummary`); "No fees updated" when nothing was written. Success toasts `applySummary` and closes; a
  failure with nothing written keeps the modal + selection for a retry; a
  partial failure closes (the preview is stale) and says to reopen. Escape/
  backdrop can't close it while applying.
- `_lib/feeOverwriteSelection.ts` (+ test) — pure client half of the
  overwrite: mirrored response types (never imports the server module),
  `groupOverwriteRows`, `applyPayload` (ticked rows → changes),
  `batchRows`/`APPLY_BATCH_ROWS` (half the shared `FEE_OVERWRITE_MAX_CHANGES`, so a line's two fees stay in one request), `addApplyCounts`, `previewSkipNote`,
  `applySummary`.
- `_lib/pre056Connection.ts` (+ test) — `withPre056Defaults`, used by
  `dashboard/layout.tsx`'s fallback select when 056's columns don't exist yet.
- `review/_lib/reviewAccounts.ts` (+ test) — pure `accountsInOrders` (distinct
  accounts in a tab, first-seen order) and `filterByAccount` (`"all"` or one
  `connection_id`), used by `review/page.tsx`.
- `review/_lib/seedOrderFees.ts` (+ test) — pure seeding of the per-order fee
  inputs from the `fees` the review route attaches to eBay orders (Finances
  API); `review/_lib/failedAccountCount.ts` (+ test) — counts failed accounts
  from `errors` only (never `warnings`).
- `review/page.tsx` — "Review Orders" page at `/dashboard/integrations/review`.
  Fetches `GET /api/integrations/review` on mount (only when eligible), renders
  platform tabs (eBay / Amazon), an order table with checkbox selection
  (already-imported rows greyed out with ✓), and an "Import selected (N)" button
  that posts to `POST /api/integrations/review/import`. On success: toasts, flips
  imported rows in local state, calls `router.refresh()` to re-hydrate
  `salesSlice`. Applies the same plan/`can("integrations", 2)` guards as
  `page.tsx` — redirects to
  `/dashboard/integrations` if not eligible.
  **Accounts (multi-account)**: when the active tab's orders span more than one
  account, an "Account" `<select>` (All accounts / each account) sits above the
  fee toolbar and an "Account" column (`order.account_name`) appears after Order
  ID. Changing the account clears the selection; switching tab resets it to
  "all". `pausedAccounts` from the response renders a "Not shown (paused)" note.
  Import/sync failures map `INTEGRATION_ACCOUNT_*` codes via
  `integrationErrorMessage`. The import payload is the full `ReviewOrder`, so
  each item carries its `connection_id` (the route 409s without it).
  **"Sync Statuses" button (2026-09-07)**: a second, independent submission
  path to the *same* import route — re-fetches `GET /api/integrations/review`
  for fresh platform data, collects every order already marked `imported:
  true` across **both** platform tabs (not just the active one), and POSTs
  them to `POST /api/integrations/review/import` with no
  `purchaseCosts`/`orderFees` keys. This reaches orders the checkbox-based
  Import flow can never re-select (already-imported rows render a static "✓"
  instead of a checkbox), and relies entirely on `mergeImportedSale.ts`'s
  existing platform-owned/user-owned field split — no new backend code. See
  `docs/superpowers/specs/2026-09-07-order-status-pull-sync-design.md` for
  the full design.
  **Fee entry (2026-08-27)**: per-order "Ad Fee"/"Platform Fee" `€` inputs
  (transient local state, `orderFees`, same shape/pattern as the existing
  `purchaseCosts` column) plus a bulk toolbar above the table — "Apply X% to
  N selected" for each fee, computed as `X% × that order's own total_amount`
  via `computeFeeFromPercent` (`lib/utils/currency.ts`) and written into
  every selected row's per-order field (overwriting whatever was already
  there; still hand-editable afterward per row). Neither eBay's nor Amazon's
  order-listing API returns a fee breakdown at that granularity, which is
  why this exists here rather than being read from the order data itself.
  `handleImport` posts `orderFees` alongside `items`/`purchaseCosts`; the
  import route parses each to a number (blank/invalid → `null`) and passes
  them into `normalizedOrderToSaleRow`'s new optional 4th argument. No
  percent toggle per row (table space) — bulk-percent is the only percent
  entry point here, unlike the Add/Edit Sale modals' per-field toggle
  (`dashboard/sales/_components/FeeAmountOrPercentField.tsx`).
  **eBay fee prefill (Finances API)**: for eBay orders the review route now
  attaches `fees` (only on not-yet-imported orders whose currency equals the
  fees' currency — `prefillFeesFor`; the Finances fetch runs in parallel with
  `fetchOrders`); the page seeds the Ad/Platform Fee inputs from them via
  `_lib/seedOrderFees.ts` (still hand-editable). The route fetches `SALE`
  (selling fees) **and** `NON_SALE_CHARGE`, because eBay books the Promoted
  Listings ad fee ("Anzeigengebühr") as a separate order-linked charge, not
  in the SALE's `marketplaceFees`; `withOrderLinkedAdFees` merges it into the
  Ad Fee prefill (2026-10-21; rules in `src/lib/integrations/SKILL.md`'s
  ad-fee gotcha). A missing `sell.finances`
  scope is returned in the response's `warnings` map (yellow banner, NOT a
  failed account); real fetch failures stay in `errors`.
- `_store/integrationsSlice.ts` — `state.integrations = { connections:
  PlatformConnection[]; accounts: PlatformAccount[] }`. `connections` is the
  admin view (`platform_connections` safe columns; RLS makes it `[]` for
  non-admins); `accounts` is the token-free list every member can read (RPC
  `get_platform_accounts`, migration 056) for filters/pickers. Actions:
  `hydrateConnections`, `hydrateAccounts`, `upsertConnection` (replace-or-append
  by `id`; also mirrors into `accounts`), `setConnectionStatus({ id, status })`
  (by `id`; updates both lists; no-op for unknown id). Several accounts per
  platform coexist.
- `_store/integrationsSlice.test.ts` — reducer tests for all four actions.

## Data flow (different from other features)

This folder **never talks to Supabase directly** — there's no
create/update/delete here. State is read-only Redux, hydrated once by
`dashboard/layout.tsx` from `platform_connections` (safe columns only, no
tokens — see that folder's `CLAUDE.md`). All mutations go through API routes
in `src/app/api/integrations/` which own `platform_connections` and write
orders into `sales`. See `src/lib/integrations/SKILL.md` for the OAuth + sync
pipeline those routes call into.

Connection management (`page.tsx`) shows platform cards with "Review orders"
links (nav to `/dashboard/integrations/review`) when `canManage` and connected.
There is no automatic or cron-based sync — all order imports are manual through
the review flow.

The **order review flow** (`review/page.tsx`) fetches the last 90 days of
orders from all connected platforms via `GET /api/integrations/review`, marks
each as `imported: boolean` (by querying `sales` for existing
`external_order_id` matches), renders platform tabs with a selectable order
table, and posts selected items to `POST /api/integrations/review/import` to
upsert them into `sales` and update `last_synced_at` per platform.

## API routes

- **`/api/integrations/review/route.ts`** (`GET`) — fetches orders from all
  connected platforms (90-day lookback via `adapter.fetchOrders`), queries
  `sales` for existing `external_order_id` values, attaches `imported: boolean`
  to each `NormalizedOrder`, and returns `{ ebay?, amazon?, errors?, warnings?, pausedAccounts? }` (`warnings`, keyed by connection id, holds the non-fatal `INTEGRATION_FINANCES_SCOPE` / `INTEGRATION_FINANCES_SIGNATURE` hint; eBay orders also carry `fees`). Iterates every ACTIVE account (`resolveActiveAccounts`); each order carries `connection_id` + `account_name`; `errors` is keyed by connection id and holds generic copy naming the account (raw errors are logged server-side).
  Exports `ReviewOrder` and `ReviewResponse` types (used by `review/page.tsx`
  via `import type`).
- **`/api/integrations/review/import/route.ts`** (`POST`) — accepts
  `{ items: { platform, order }[], purchaseCosts?, orderFees? }`, maps each
  item to a `SaleInsert` via `normalizedOrderToSaleRow` (passing
  `orderFees[order.external_order_id]` — parsed to numbers, blank/invalid →
  `null` — as the new optional 4th `fees` argument), upserts into `sales`
  with `onConflict: "platform,external_order_id"`, updates `last_synced_at`
  per account. Rejects (409 `INTEGRATION_ACCOUNT_PAUSED`) items whose
  `connection_id` isn't an active account (`invalidImportItems`), and stamps
  `sales.connection_id`. Returns `{ imported: number }`.
- **`/api/integrations/ebay/charges/sync/route.ts`** (`POST`) — `{ connectionId }`;
  fetches `SALE`, `REFUND` and charge transactions; imports the account's
  non-order eBay charges as Expenses (category `platform_fees`, `advertising`
  or `shipping`; a bare `CREDIT` only when it has a `feeType`) and fills empty
  order fees in the sale's own currency; charges tied to an order fill that
  order's fee fields instead of becoming expenses; a REFUND's fee credit
  becomes a negative `platform_fees` expense when its sale exists and is not
  returned/cancelled. `maxDuration = 60`. Returns `{ chargesImported,
  chargesAlreadyImported, skippedCurrency, skippedInvalid (missing/0 amount),
  nonFeeCreditsSkipped, currencyMismatch, ordersFeesFilled,
  ordersFeesNotWritten, orderLinkedCreditsSkipped, orderLinkedUnmatched (per
  order), orderLinkedAlreadyFilled (per field), refundCreditsImported,
  refundCreditsSkipped }` or `{ error }` (409
  `INTEGRATION_FINANCES_DB_PENDING` before migration 058). Rules and the
  refund-credit limitation: `src/lib/integrations/SKILL.md` "Gotchas — Finances".
- **`/api/integrations/ebay/fees/preview/route.ts`** (`POST`, 2026-10-21) —
  `{ connectionId }`; guard `requireIntegrationSuperAdmin()` (integrations ≥ 2
  AND `profiles.role = super_admin`, else 403). Fetches 90 days of `SALE` +
  `NON_SALE_CHARGE` + `CREDIT` (ad-fee refunds arrive as `CREDIT`; shipping labels not fetched), reads the touched sales (`loadOverwriteSales`) and returns
  `computeFeeOverwrites`' `{ changes: { saleId, externalOrderId, currency,
  date, field, from, to }[], currencyMismatch, notImported }` — order-linked charges and credits matched per feeType (ambiguous → nothing
  proposed), platform fee incl. order-linked charges (rules:
  `src/lib/integrations/SKILL.md`). **No writes.**
  Errors: 409 `INTEGRATION_ACCOUNT_*` / `INTEGRATION_FINANCES_SCOPE` /
  `INTEGRATION_FINANCES_SIGNATURE`, 502 generic.
- **`/api/integrations/ebay/fees/apply/route.ts`** (`POST`, 2026-10-21) —
  `{ connectionId, changes: { saleId, field, from, to }[] }` validated by
  `parseFeeOverwriteApply` (400; max 2000). Same guard; checks the account is
  active, then `applyFeeOverwrites` (compare-and-set per field, scoped to
  this account or legacy unassigned rows, never stops midway) and a batched
  insert of one `update`/`sale` audit row per applied fee (`metadata.source =
  "ebay_fee_overwrite"`) — also on partial failure. Returns `{ applied, stale }`
  via `applyCounts`: `applied` in order lines, `stale`/`failed` in fee writes; 403/502 carry the same counts plus `error`.
- **`/api/integrations/connections/[id]/route.ts`** (`PATCH`) — rename / pause /
  resume one account (`parseConnectionPatch`; resume gated by `canResumeAccount`, 409 `INTEGRATION_RESUME_LIMIT` at the cap).
- `[platform]/disconnect` now takes `{ connectionId }` and keeps the row;
  `[platform]/connect` redirects back with `error=INTEGRATION_ACCOUNT_LIMIT`
  at the cap (`?reconnect=<id>` skips; every refusal is a redirect, never
  JSON — it's a full-page navigation); the
  callback redirects with `account=<id>`.

## Plan gating

`state.currentUser.planEntitlements` is hydrated by `dashboard/layout.tsx`
from the plan catalog (`control.plans`, `getPlanCatalog()`) and read via
`usePlan()`. `hasPlatformIntegrations(ent)` (`src/lib/plans/entitlements.ts`)
returns the plan's `platformIntegrations` flag; null (not hydrated) ⇒ not
entitled. The upgrade copy comes from `availability("platformIntegrations",
…)` — never hardcode plan names. The API routes (`review`, `review/import`,
`[platform]/connect`) check `getEntitlements(tenant.plan)` server-side: 500
"Could not check your plan" if the `control.tenants` lookup (`maybeSingle`)
or the catalog read fails, 403 "Platform
integrations are not included in your plan." otherwise (a missing tenant row
now fails closed — the old `?? "trial"` fallback is gone).

## Shared dependencies

- `src/lib/integrations/` — server-only OAuth adapters + order-fetch/import pipeline (not
  imported here directly, only via the API routes); `mapToSale.ts`'s
  `normalizedOrderToSaleRow`/`ReviewOrderFees` specifically for the fee-entry
  feature above
- `src/lib/plans/entitlements` — `hasPlatformIntegrations`
- `src/lib/utils/currency` — `computeFeeFromPercent` (bulk fee-percent toolbar)
- `src/store/useAccess` — `useAccess().can("integrations", 2)` (Task 5 —
  replaced `lib/utils/permissions`' `hasPermission`)
- `src/lib/utils/date` — `formatDateTime`
- `components/layout/PageHeader`, `components/ui/{Badge,Button,Toast}`
- `store/usePlan` — `ent`, `availability`
- `types` — `IntegrationPlatform`, `PlatformConnection`,
  `PlatformConnectionStatus`

## Tests

`npx jest dashboard/integrations` runs `_store/integrationsSlice.test.ts`,
the `_lib/*.test.ts` files (incl. `feeOverwriteSelection`) and the
`review/_lib/*.test.ts` files. Server half of the fee overwrite:
`npx jest src/lib/integrations/ebay/feeOverwrite src/lib/utils/feeOverwriteAccess`.
