# Integrations feature

Route: `/dashboard/integrations`. Lets a tenant connect their eBay and/or
Amazon seller accounts via OAuth; orders from connected platforms are reviewed
and imported manually via `/dashboard/integrations/review` and stored as
`sales` ("Orders") rows. Available only on the **Pro**/**Business** plans
(`hasPlatformIntegrations`) and manageable only by `admin`/`super_admin`
(`manage_integrations` permission).

## Files in this folder

- `page.tsx` — `"use client"`. Default export wraps `IntegrationsContent` in
  `<Suspense fallback={null}>` (required because it reads `useSearchParams()`
  for the `connected=`/`error=` query params set by the OAuth callback route
  and shows a `Toast` for each). Reads `role`/`tenantPlan` from
  `state.currentUser` and `connections` from `state.integrations.connections`.
  Three render branches, in order:
  1. `!tenantPlan || !hasPlatformIntegrations(tenantPlan)` → upgrade-prompt
     card linking to `/dashboard/settings`.
  2. `!hasPermission(role, "manage_integrations")` → "contact your admin"
     message.
  3. Otherwise → a `sm:grid-cols-2` grid of `<ConnectionCard>`, one per
     `IntegrationPlatform` (`["ebay", "amazon"]`).
- `_components/ConnectionCard.tsx` — per-platform card: status `Badge`
  (`connected`/`disconnected`/`error`), `external_account_id` (if set), "Last
  synced" (`formatDateTime` or "Never"), `last_sync_error` (if present). When
  `canManage` and connected: a "Review orders" `<Link>` (navigates to
  `/dashboard/integrations/review`) and a "Disconnect" button
  (`POST /api/integrations/{platform}/disconnect`). When disconnected: a
  "Connect {label}" button that does `window.location.assign(\`/api/integrations/${platform}/connect\`)` (a full
  navigation, not `fetch` — the connect route 302s to the platform's OAuth
  consent screen). The "Sync now" button and `handleSync` logic have been
  removed — syncing is now manual via the review page.
- `review/page.tsx` — "Review Orders" page at `/dashboard/integrations/review`.
  Fetches `GET /api/integrations/review` on mount (only when eligible), renders
  platform tabs (eBay / Amazon), an order table with checkbox selection
  (already-imported rows greyed out with ✓), and an "Import selected (N)" button
  that posts to `POST /api/integrations/review/import`. On success: toasts, flips
  imported rows in local state, calls `router.refresh()` to re-hydrate
  `salesSlice`. Applies the same plan/role guards as `page.tsx` — redirects to
  `/dashboard/integrations` if not eligible.
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
- `_store/integrationsSlice.ts` — `state.integrations.connections:
  PlatformConnection[]`. Actions: `hydrateConnections`, `upsertConnection`
  (replace-or-append by `platform`), `setConnectionStatus` (no-op if no
  connection exists for that platform yet).
- `_store/integrationsSlice.test.ts` — reducer tests for all three actions.

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
  to each `NormalizedOrder`, and returns `{ ebay?, amazon?, errors? }`.
  Exports `ReviewOrder` and `ReviewResponse` types (used by `review/page.tsx`
  via `import type`).
- **`/api/integrations/review/import/route.ts`** (`POST`) — accepts
  `{ items: { platform, order }[], purchaseCosts?, orderFees? }`, maps each
  item to a `SaleInsert` via `normalizedOrderToSaleRow` (passing
  `orderFees[order.external_order_id]` — parsed to numbers, blank/invalid →
  `null` — as the new optional 4th `fees` argument), upserts into `sales`
  with `onConflict: "platform,external_order_id"`, updates `last_synced_at`
  per platform. Returns `{ imported: number }`.

## Plan gating

`tenantPlan` (`TenantPlan | null`) is hydrated into
`state.currentUser.tenantPlan` by `dashboard/layout.tsx` (fetched from
`control.tenants` via `createControlClient()`). `hasPlatformIntegrations(plan)`
(`src/lib/utils/planGating.ts`) returns `true` only for `pro`/`business`.

## Shared dependencies

- `src/lib/integrations/` — server-only OAuth adapters + order-fetch/import pipeline (not
  imported here directly, only via the API routes); `mapToSale.ts`'s
  `normalizedOrderToSaleRow`/`ReviewOrderFees` specifically for the fee-entry
  feature above
- `src/lib/utils/planGating` — `hasPlatformIntegrations`
- `src/lib/utils/currency` — `computeFeeFromPercent` (bulk fee-percent toolbar)
- `src/lib/utils/permissions` — `hasPermission`, `manage_integrations`
- `src/lib/utils/date` — `formatDateTime`
- `components/layout/PageHeader`, `components/ui/{Badge,Button,Toast}`
- `store/slices/currentUserSlice` — `profile.role`, `tenantPlan`
- `types` — `IntegrationPlatform`, `PlatformConnection`,
  `PlatformConnectionStatus`

## Tests

`npx jest dashboard/integrations` runs `_store/integrationsSlice.test.ts`.
