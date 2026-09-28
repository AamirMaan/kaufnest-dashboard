# Dashboard shell + Overview

This is the entry point for everything behind login. **Each subfolder is its own
feature with its own `CLAUDE.md`/`SKILL.md` — read those instead of exploring
broadly when working on a specific feature.**

## Files at this level

- `layout.tsx` — server component: auth-guards the route (`redirect("/login")`
  if no session/profile), fetches the first page of every collection
  (sales/expenses/purchases/products/audit_logs/profiles/**company_profile**/
  **platform_connections**/dropship_listings/platform_payouts/
  ebay_listing_drafts/**ebay_messages**)
  from Supabase **once**, and hydrates them into Redux via `<StoreProvider>` so
  individual pages never refetch on mount. Also reads the `kaufnest_impersonating`
  cookie, and calls `isPlatformAdmin(user.email)` (`@/lib/supabase/control`) to
  compute `isPlatformAdmin` — both are passed to `<DashboardShell>` (the
  impersonation banner and the sidebar's "Admin Panel" link, respectively).
  Additionally, when `tenant_schema` is present, fetches the tenant's
  `plan, ai_enabled, shipping_labels_enabled` from `control.tenants` via
  `createControlClient()` and passes them to `<StoreProvider>` as
  `tenantPlan` (hydrated into `currentUserSlice.tenantPlan`, read by the
  Integrations page for plan gating via `hasPlatformIntegrations`),
  `aiEnabled` (hydrated into `currentUserSlice.aiEnabled`, read by the
  Listings page to decide whether AI controls render at all — `ai_enabled`
  is the platform-admin AI visibility switch, control-plane migration 007),
  and `shippingLabelsEnabled` (hydrated into
  `currentUserSlice.shippingLabelsEnabled`, read by the Sales order-detail
  page to decide whether EasyPost label purchasing is offered vs. a plain
  PDF label fallback — `shipping_labels_enabled` is the platform-admin
  EasyPost visibility switch, control-plane migration 010, defaults false,
  no plan tie). The `platform_connections` select
  only includes the non-token columns (RLS restricts the table to
  admin/super_admin anyway). Wraps everything in `<ToastProvider>` and
  `<DashboardShell>`.
  **If you add a new feature with its own collection, hydrate it here.**
- `page.tsx` — **Home** (`/dashboard`) = **the numbers; every chart lives on
  `/dashboard/analytics`** (split settled 2026-09-28 — Home had briefly held
  the trend chart + donut, and the per-platform balance figures had moved to
  Analytics; users missed those per-platform numbers on Home). Renders
  exactly: 6 `KpiTile`s in a `xl:grid-cols-3` grid (Revenue, Net Profit,
  Orders, Expenses, Purchases, VAT payable/refundable — value, Δ% vs the
  previous equal-length period, trailing-12-month sparkline), a "By Platform"
  section of `PlatformStatsCard`s (one per platform with sales in the range,
  built by `_lib/platformStats.ts`; admins get "Record Transfer" on the
  eBay/Amazon cards, which opens `RecordTransferModal`),
  `RecentOrdersCard` (latest orders table), then the Quick Start card.

  **Does NOT read `sales`/`expenses`/`purchases`/`platform_payouts` from
  Redux** — those slices hold only one paginated page (50 rows,
  most-recent-first) each, and get replaced wholesale whenever the
  Sales/Expenses/Purchases pages fetch a different page, so this page's
  date-ranged aggregates would silently go wrong once a tenant had more than
  one page of records (see the 2026-07-27 fix). Instead all data comes from
  `_components/useOverviewData.ts`, a hook shared with `analytics/page.tsx`:
  the same 5 RPCs as before (`get_sales_overview`/`get_expenses_overview`/
  `get_purchases_overview`/`get_payouts_overview`/`get_overview_timeseries`,
  see `supabase/CLAUDE.md`'s migration 045/051 entries) scoped to the picked
  date range, **plus a second, independent `get_overview_timeseries` call for
  a fixed trailing-12-month window** (`trailingRange()` in `_lib/kpiTiles.ts`)
  that reruns only when `profileCurrency` changes, not on every date-range
  pick. That trailing series is what feeds every KPI sparkline and
  `OverviewTrendCard` — a one-month picked range still shows a real 12-month
  trend instead of a single point (see `SKILL.md`'s gotcha). Results live in
  the hook's own `useState`, not a Redux slice. `isLoading` drives the same
  "opacity-60 pointer-events-none" overlay convention used by the paginated
  list pages. `trailingLoading` (2026-09-27) is a separate flag scoped to just
  the trailing call — true until it first resolves (success or error) and
  true again on a currency-triggered refetch — so `OverviewTrendCard` can
  show a pulse skeleton instead of falsely rendering "No data in this period"
  while `trailing` is still null.

  The date-range filter (`_components/useDateRangePicker.ts` +
  `DateRangePicker.tsx`, extracted 2026-09-27 from what used to be this
  file's own inline UI) wraps `resolveDateRange`/`resolveDateBounds` from
  `lib/utils/filters`, preset + custom from/to plus "Specific period"
  (`periodRange`/`describePeriod`/`fetchEarliestYear`) — same logic as
  before, now shared with Analytics; each page still owns its **own**
  `useDateRangePicker()` instance, so the two pages' pickers are not synced
  (by design, see `analytics/SKILL.md`). RPC params come from
  `resolveDateBounds` (null for an open side), not `range` — see `SKILL.md`.

  `RecentOrdersCard` deliberately does **not** go through `useOverviewData`
  or the `sales` slice — it runs its own `.limit(RECENT_ORDERS_LIMIT)` (5)
  query straight against `sales` via `createTenantClient()`, since "latest N
  orders regardless of the picked range" isn't something either data source
  gives you. It imports `avatarClassesFor` from
  `messages/_lib/avatarColor.ts` for its row avatars — that helper's second
  consumer, see `messages/CLAUDE.md`.

  All charts (`OverviewTrendCard`, `PlatformDonutCard` and the detail cards
  Revenue/Net Profit/Expenses/Purchases/Orders/VAT Position/eBay+Amazon
  Balance/Top Products) live on `/dashboard/analytics` — see
  `analytics/CLAUDE.md`. They're still built from components in this folder's
  `_components/`, listed below.

  Shared deps: `formatCurrency`/`calculateNetProfit`, `resolveDateRange`/
  `resolveDateBounds`, `periodRange`/`describePeriod`, `useTheme`, `recharts`,
  `lib/supabase/client` (`createTenantClient`), `lib/utils/fetchEarliestYear`.

## `_components/` — Overview family (shared by Home and Analytics)

Home-only:
- `PlatformStatsCard.tsx` (2026-09-28) — numbers-only per-platform card:
  revenue + share %, and for eBay/Amazon (`stat.balance` non-null) orders,
  avg. order, ad fees, shipping, platform expenses, balance earned,
  transferred and "Still in <platform> account" (warning/danger tone), plus
  an optional admin "Record Transfer" button. Chart counterpart on Analytics
  is `PlatformBalanceCard`.
- `KpiTile.tsx` — Apex-style stat tile: label/value/icon chip, ▲/▼ delta vs
  the previous equal-length period (hidden when `delta` is null, e.g. "All
  Time"), edge-to-edge sparkline (`recharts` `AreaChart`, always fed the
  trailing-12-month series regardless of the picked range). Sparkline color
  is a hex value from `useChartKit().colors` (SVG `fill`/`stroke` attrs can't
  read CSS custom properties). Gradient id is `useId()`-derived and sanitised
  (`.replace(/[^a-zA-Z0-9_-]/g, "")`) before use in a `url(#…)` reference —
  see `SKILL.md`'s gotcha.

Analytics-only (headline charts, moved off Home 2026-09-28):
- `OverviewTrendCard.tsx` — Analytics' headline chart, heading "Performance"
  (not "Overview" — that's the page title): last 12 months, switchable
  Revenue/Orders/Profit via a segmented control; always reads `trailing`,
  never the picked-range `timeseries`. Takes a `loading` prop
  (`useOverviewData`'s `trailingLoading`) and renders a pulse skeleton in the
  300px chart slot while it's true, instead of "No data in this period".
- `PlatformDonutCard.tsx` — revenue-by-platform donut (`_lib/platformShare.ts`)
  + legend with per-platform %; platforms with negative net revenue are
  excluded (a donut can't draw them).

Home-only (continued):
- `RecentOrdersCard.tsx` — latest `RECENT_ORDERS_LIMIT` (5) orders, own
  Supabase query (bypasses the `sales` slice — see `SKILL.md`'s gotcha),
  each row links to `/dashboard/sales/[id]`.
- `RecordTransferModal.tsx` — records a platform payout (admin only; opened
  from a `PlatformStatsCard`'s "Record Transfer" on Home).

Shared by Home and Analytics:
- `useDateRangePicker.ts` / `DateRangePicker.tsx` — the date-range picker
  state + UI (preset/custom/"Specific period"). Each page owns its **own**
  instance; the two pickers are deliberately not synced (`analytics/SKILL.md`
  gotcha).
- `useOverviewData.ts` — the hook described in the `page.tsx` entry above:
  the 5 range-scoped RPCs plus the independent trailing-12-month
  `get_overview_timeseries` call.
- `useChartKit.ts` — `useChartKit(currency)`: theme-aware colors
  (`chartTheme`), shared axis/tooltip/legend props, `money`/`compact`
  formatters.

Analytics-only (moved off Home 2026-09-27; still live here since
`analytics/page.tsx` imports them via `../_components`):
- `ChartCard.tsx` — card shell: title, headline, ▲/▼ change badge
  (`changeTone`/`formatPct`), meta line, optional header action, a
  `bodyClassName` slot (default `"mt-4 h-[220px]"` fixed-height chart area —
  `TopProductsCard` passes `"mt-4"` instead since its table's rows exceed the
  220px slot), "No data in this period" empty state.
- `StackedBars.tsx` — monthly stacked bars used by Revenue and Expenses.
- `RevenueCard.tsx`, `NetProfitCard.tsx`, `ExpensesCard.tsx`,
  `PurchasesCard.tsx`, `OrdersCard.tsx`, `VatCard.tsx`,
  `PlatformBalanceCard.tsx` — one per detail card.
- `TopProductsCard.tsx` — **ranked table, not a bar chart** (changed
  2026-09-27): rank / product / share bar / units / revenue per row, top 5
  (`get_sales_overview` already groups, sorts and limits).

## `_lib/` — pure helpers for the Overview page

The pure modules below (no React/Supabase/Redux) each have a colocated
test — `npx jest dashboard/_lib`. Keep new Overview maths in this shape:
extracting it is what makes it testable without rendering the page.

- `aggregateSales.ts` — `aggregateSaleRevenue(sales) → { revenue, fees }`.
  Filters through `isRevenueSale` first (so returned/cancelled orders are
  excluded — see `lib/utils/filters.ts`), then sums
  `total_amount + (shipping_charged ?? 0)` into `revenue` and
  `(shipping_cost ?? 0) + (advertising_fee ?? 0)` into `fees`. **As of
  2026-09-17 `page.tsx` no longer calls this** — the same formula now lives
  in the `get_sales_overview` Postgres function instead (migration
  `045_overview_aggregation_functions.sql`). It's kept here because
  `dashboard/sales/page.tsx` still uses it for its own client-side revenue
  total; move it into `sales/_lib/` if Sales ever becomes its only caller.
- `platformBalance.ts` — `computePending(balance: number, transferred: number)
  → number`. Subtracts a transferred-amount total from a **pre-computed**
  balance; both are now the corresponding platform's fields read out of
  `get_sales_overview`/`get_payouts_overview`'s results (via
  `computePlatformBalance()`, called from `analytics/page.tsx` for the
  `PlatformBalanceCard` charts and from `platformStats.ts` for Home's stat
  cards) rather than reduced from raw payout rows.
- `fetchAllRows` (`src/lib/utils/fetchAllRows.ts`) is **no longer used by
  Home or Analytics** as of the 2026-09-17 RPC rewire — `_components/useOverviewData.ts`
  fetches pre-aggregated JSON via `supabase.rpc(...)` calls instead of paging
  through raw `sales`/`expenses`/`purchases`/`platform_payouts` rows, so the
  "Max Rows" gotcha below no longer applies here. It's still used by the
  Sales/Expenses/Purchases CSV-export queries — see its bullet in the repo
  root `AGENTS.md`'s shared `src/lib/*` list.
- `overviewTypes.ts` — response types of the five RPCs plus
  `PlatformBalance`.
- `overviewCharts.ts` — pure series shaping for the cards: `pctChange`,
  `changeTone`, `formatPct`, `margin`, `monthLabel`, `sumMonths`,
  `stackedSeries`, `netProfitSeries`, `bestWorstMonth`, `topCategoryShare`,
  `returnRate`, `balanceBars`.
- `chartPalette.ts` — hex palette (platforms, categories, fallbacks),
  `seriesColor`, `chartTheme(isDark)`, `compactMoney`.
- `kpiTiles.ts` (2026-09-27) — `buildKpis(data) → KpiSet` (`revenue`,
  `netProfit`, `orders`, `expenses`, `purchases`, `vatPosition`, each
  `{ value, delta, spark }`): headline `value`/`delta` follow the **picked
  range** (the 045 overviews + 051's `previous`); `spark` always comes from
  the **trailing-12-month** timeseries regardless of range
  (`monthRevenue(m)` sums a month's `revenue_by_platform`). Also exports
  `trendSeries(months, metric)` (feeds `OverviewTrendCard`) and
  `trailingRange(today) → { from, to }` (first day of the month 11 months
  back, through `today` — the window `useOverviewData`'s second RPC call
  uses). Colocated test.
- `platformStats.ts` (2026-09-28) — `buildPlatformStats(sales, expenses,
  payouts) → PlatformStat[]` for Home's `PlatformStatsCard`s: one entry per
  `revenueByPlatform` row, sorted by revenue desc, with `sharePct` of the
  positive total (a net-negative platform gets 0%) and `balance` from
  `computePlatformBalance()` for eBay/Amazon only (045's `platformBalance`
  only buckets those two, so other platforms show revenue + share only).
  Colocated test.
- `platformShare.ts` (2026-09-27) — `platformShares(rows) → { total, shares }`
  for `PlatformDonutCard`: filters to positive-value rows only (a
  refund-heavy platform can net negative; a donut can't draw that), sorted
  largest-first. Colocated test.
- `recentOrderDisplay.ts` (2026-09-27) — `RECENT_ORDERS_LIMIT` (5 — a fixed
  card size, not a business-growth bound), `platformLabel()`, `buyerLabel()`
  (buyer name when captured, else the platform label), `initials()` — all for
  `RecentOrdersCard`'s row avatar/name. Colocated test.
- `platformBalance.ts` now also exports `computePlatformBalance()` (moved
  out of `page.tsx` originally, now called from `analytics/page.tsx` and
  `platformStats.ts`).
- `overviewTimeseries.integration.test.ts` (2026-09-27) — live test of 051's
  `get_overview_timeseries`, same setup as the one below; run after 051 is
  applied.
- `overviewRpc.integration.test.ts` (2026-09-17) — NOT a pure `_lib` unit
  test like the two above: it hits the four real `get_sales_overview`/
  `get_expenses_overview`/`get_purchases_overview`/`get_payouts_overview`
  Postgres functions (migration `045_overview_aggregation_functions.sql`)
  live over the network against `tenant_boughtopia`, inserting and then
  deleting real `sales`/`expenses` rows via `createServiceClientForTenant`
  (`src/lib/supabase/server.ts`) to bypass RLS for setup/teardown. Excluded
  from `npx jest`'s default run and `.husky/pre-push` — separate config
  (`jest.integration.config.ts`, repo root) and script (`npm run
  test:integration`). See `SKILL.md`'s gotcha for why it can't just call
  `process.loadEnvFile(".env.local")` like the other npm scripts do.

## Feature folders (each documents itself — start there)

| Folder | Route | What it owns |
| --- | --- | --- |
| `analytics/` | `/dashboard/analytics` | every chart — trend, platform donut, detail chart cards (components shared with Home in `_components/` above) |
| `sales/` | `/dashboard/sales` | sales records ("Orders" in UI), `salesSlice` |
| `expenses/` | `/dashboard/expenses` | expense records, `expensesSlice` |
| `purchases/` | `/dashboard/purchases` | inventory purchases, `purchasesSlice` |
| `inventory/` | `/dashboard/inventory` | product catalog + stock levels, `inventorySlice` (stock kept in sync via DB triggers off linked purchases/sales — see its CLAUDE.md) |
| `users/` | `/dashboard/users` | user invites/roles/permission overrides/deactivation, `usersSlice` (super_admin only) |
| `audit-logs/` | `/dashboard/audit-logs` | activity trail viewer (slice is shared, see its CLAUDE.md) |
| `settings/` | `/dashboard/settings` | invoice template settings |
| `integrations/` | `/dashboard/integrations` | eBay/Amazon platform connections, `integrationsSlice` (Pro/Business plans only, see its CLAUDE.md) |
| `listings/` | `/dashboard/listings` | eBay listing creation (draft → publish), `listingsSlice` (Pro/Business plans only, `manage_listings` permission) |
| `messages/` | `/dashboard/messages` | eBay buyer message sync/reply, `messagesSlice` (Pro/Business plans only, `manage_messages` permission) |
| `support/` | `/dashboard/support` | bug reports + tenant-scoped tracker board, `supportSlice` (all roles, all plans, see its CLAUDE.md) |

## Shared shell components (live outside, in `src/components/layout/`)

`DashboardShell` (header, user menu, theme toggle, impersonation banner —
forwards `isPlatformAdmin` to `Sidebar`; now takes a `userId` prop, sourced
from `layout.tsx`'s `profile.id`, that it forwards to `NotificationBell`),
`Sidebar` (nav + role-based links + collapse; renders an "Admin Panel" link
to `/admin` when `role === "super_admin" && isPlatformAdmin`), `PageHeader`
(page title/description/actions row used by every feature page), `BrandMark`
(2026-08-28 — the Boughtopia bag-icon mark next to the wordmark in
`DashboardShell`'s header, `Sidebar`'s mobile header, and `admin/layout.tsx`'s
header; a client component that reads `useTheme()` to switch between the
navy and white-mono SVG under `public/brand/`, since those three surfaces'
background/text color both flip with the light/dark theme toggle — the
`(auth)/` pages use it too since they became theme-aware on 2026-09-09),
`NotificationBell` (the bell icon in the header — client component, not a
route/feature of its own; polls `fetchNotifications({ userId })` every 60s
via `setInterval`, no push/realtime). **Visibility is decided entirely by
the `notifications_select` RLS policy** (migration 028) — the client has no
role/permission filtering logic for notifications, unlike every other
feature's row-level checks, specifically so the rule can't drift between two
copies. Low-stock entries are not database rows: `synthesizeLowStock()`
(`src/lib/utils/notifications.ts`) computes them at read time from the
`products` table and merges them into the feed client-side — see
`inventory/SKILL.md`'s gotcha for why there's no low-stock trigger.

## Cross-cutting state & infra

`src/store/{store.ts,hooks.ts,StoreProvider.tsx}` + the shared slices
`auditLogsSlice`/`currentUserSlice`/`notificationsSlice` in
`src/store/slices/`. `notificationsSlice` (`state.notifications`) is read
only by `NotificationBell` — it isn't hydrated by `dashboard/layout.tsx`
like the paginated collections above; `NotificationBell` fetches it itself
on mount via `fetchNotifications` (see `src/lib/utils/notifications.ts` for
the pure `isUnread`/`unreadCount`/`synthesizeLowStock`/`buildFeed`/
`latestStoredTimestamp` helpers it uses — `buildFeed` is the only place the
stored/synthetic merge happens, and `unreadCount` deliberately excludes
synthetic items from the badge count since their timestamp is regenerated
on every read). See
`AGENTS.md` (repo root) → "Project structure" for the full
shared-vs-feature-private map.

**Trial expiry (2026-08-28):** `src/proxy.ts` locks out expired trials by
reusing the same `control.tenants` row it already fetches for the
deactivation check — the `select` carries `status, plan, trial_ends_at` and
feeds `isTrialExpired` (`lib/utils/trial.ts`). Expired trials land on
`/trial-expired`. That page, like `/account-deactivated`, **must stay out of
`proxy.ts`'s matcher** or it redirects to itself forever. Tenant data is
never touched at expiry; restoring access is a plan change in `/admin` OR
(2026-08-29) a real Stripe checkout from `/trial-expired`'s own `PlanPicker`
— the webhook flips `plan`/`status` once the subscription is created.

`/trial-expired` has no `StoreProvider` (it's outside `/dashboard`), so it
can't read a Redux role for gating `PlanPicker` the way
`dashboard/settings/_components/BillingSection.tsx` does. Instead
(2026-08-29 final-review fix) both read `canManageBilling` off `GET
/api/billing/status`'s response — computed server-side there the same way
`requireBillingAdmin` computes it — so a non-admin never sees live
Subscribe controls on either surface. `/trial-expired` also mirrors
`BillingSection`'s `?billing=success` confirmation-and-poll pattern: since a
first-time subscriber's Stripe `success_url` redirect lands on
`/dashboard/settings?billing=success` but `proxy.ts` bounces any
`/dashboard/*` request straight back to `/trial-expired` (carrying the query
string) until the webhook lands `plan`/`status`, `/trial-expired` detects
that param itself, shows a "setting up your subscription" message, polls
`status` until `hasSubscription` is true, then redirects to `/dashboard`
(which now works, since the webhook has landed by then). See
`dashboard/settings/CLAUDE.md`'s Billing section for the full detail — both
pages share this logic against the same response shape.
