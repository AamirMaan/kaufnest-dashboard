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
  `{ connectionId }` to `/api/integrations/ebay/charges/sync`, toasts the
  counts or the mapped error), Disconnect via `DeleteConfirmModal` (POST `{ connectionId }`;
  dispatches `setConnectionStatus`), and Reconnect
  (`/connect?reconnect=<id>`, skips the connect-time cap check) on
  disconnected, error-state and legacy (no `external_account_id`) rows. PATCH success
  dispatches `upsertConnection`.
- `_lib/accountSummary.ts` (+ test) — pure `platformHeading` (used by
  `PlatformAccountsSection`) and `needsReconnectBanner` (used by `page.tsx`
  and by `PlatformAccountsSection` to disable "Add account" while a legacy
  eBay row is pending).
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
  attaches `fees`; the page seeds the Ad/Platform Fee inputs from them via
  `_lib/seedOrderFees.ts` (still hand-editable). A missing `sell.finances`
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
  to each `NormalizedOrder`, and returns `{ ebay?, amazon?, errors?, warnings?, pausedAccounts? }` (`warnings`, keyed by connection id, holds the non-fatal `INTEGRATION_FINANCES_SCOPE` hint; eBay orders also carry `fees`). Iterates every ACTIVE account (`resolveActiveAccounts`); each order carries `connection_id` + `account_name`; `errors` is keyed by connection id and holds generic copy naming the account (raw errors are logged server-side).
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
  imports the account's eBay charges as `platform_fees` Expenses and fills
  empty order fees. Returns `{ chargesImported, chargesAlreadyImported,
  skippedCurrency, ordersFeesFilled }` or `{ error }`.
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
`_lib/accountSummary.test.ts` and `review/_lib/reviewAccounts.test.ts`.
