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
- `page.tsx` — the Overview/home page (`/dashboard`). **Does NOT read
  `sales`/`expenses`/`purchases`/`platform_payouts` from Redux** — those
  slices hold only one paginated page (50 rows, most-recent-first) each, and
  get replaced wholesale whenever the Sales/Expenses/Purchases pages fetch a
  different page, so this page's date-ranged aggregates would silently go
  wrong (e.g. the VAT Position section disappearing) once a tenant had more
  than one page of records, or had recently paged through those tables
  elsewhere in the app (see the 2026-07-27 fix). Instead, on mount and
  whenever the date-range filter or `profileCurrency` changes, it fetches
  all four tables' aggregates via `supabase.rpc(...)` calls to
  `get_sales_overview`/`get_expenses_overview`/`get_purchases_overview`/
  `get_payouts_overview` (see `supabase/CLAUDE.md`'s migration 045 entry and
  `docs/superpowers/specs/2026-09-16-overview-rpc-aggregation-design.md`),
  each taking the date-range filter and `profileCurrency` as SQL parameters
  — no more client-side currency filtering or row-level aggregation. Results
  are stored as four typed objects (`salesOverview`/`expensesOverview`/
  `purchasesOverview`/`payoutsOverview`) in **local `useState`**, not a Redux
  slice (page-only data, no other feature needs it). `isLoading` drives the
  same "opacity-60 pointer-events-none" overlay convention used by the
  paginated list pages.
  The date-range filter itself (`resolveDateRange` from `lib/utils/filters`,
  preset + custom from/to — including a "Specific period" mode, any
  month/quarter/year, added 2026-09-17 via `periodRange`/`describePeriod`/
  `fetchEarliestYear` from `lib/utils/`; this page has its own bespoke inline
  date-range UI rather than the shared `FilterBar` component, so it
  reimplements the same period-picking logic directly — see
  `components/ui/SKILL.md`'s FilterBar entry for the shared version) resolves
  to the `{from, to}` pair passed as `p_from`/`p_to` to the 4 RPCs above — no
  client-side row filtering (`effectiveSales`/`isRevenueSale`) remains in this
  file as of the RPC rewrite; that predicate now lives in `get_sales_overview`
  itself. Renders:
  - 5 `StatCard`s: Revenue, Expenses, Purchases, Net Profit, Orders (sale count +
    units sold) — grid expands to `lg:grid-cols-5`. Revenue, Net Profit, VAT
    Collected, monthly trend revenue, Revenue by Platform, and Top Products all
    come from `get_sales_overview`'s already-effective (returns/cancellations
    excluded) figures — only the "Orders" StatCard's count uses
    `salesOverview.orderCount` (total orders placed, including
    returns/cancellations, vs. `effectiveOrderCount` used for average order
    value).
  - Revenue/fees/VAT/monthly-trend/platform/top-product figures are exactly
    what each RPC returns — the two distinct revenue formulas (per-sale
    `total_amount + shipping_charged` vs. fees deducting `shipping_cost +
    advertising_fee`) now live in the SQL functions, not this file.
  - **VAT Position** section (hidden when no VAT data in period): VAT Collected
    (output, from sales), VAT Paid (input, purchases + expenses), net Due to
    Government / Government Refund
  - **Expenses by Category** section (hidden when no expenses): per-category totals
    sorted by spend, rendered with `CategoryBadge`
  - **Charts** section (hidden when no data in period): 2-column row with a
    `recharts` `AreaChart` (Revenue/Expenses/Purchases by month, 2/3 width) and a
    `PieChart` donut (Revenue by Platform, 1/3 width + custom legend)
  - **Top Products** and **Expenses by Category** side-by-side in a 2-col grid
    (each hidden when empty)
  - **Platform balance cards** (eBay / Amazon, one per connected platform): each
    card shows 6 tiles in a 2×3 layout — Sales, Ad Fees + Shipping, Expenses,
    Balance Earned, Transferred, Pending. `computePlatformBalance("ebay" |
    "amazon")` combines `salesOverview.platformBalance`,
    `expensesOverview.platformSubtotal`, and `payoutsOverview.transferred` for
    that platform, then calls `computePending(balance, transferred)`. A
    "Record Transfer" button (admin/super_admin only) opens
    `RecordTransferModal` (`_components/RecordTransferModal.tsx`).
  Chart colours adapt to dark/light theme via `useTheme()` — hardcoded hex values
  are passed to recharts props (CSS variables don't render reliably inside SVG).
  No `_components`/`_store` of its own — but see `_lib/` below.
  Shared deps:
  `StatCard`, `CategoryBadge`, `formatCurrency`/`calculateNetProfit`,
  `resolveDateRange`, `periodRange`/`describePeriod`, `ExpenseCategory` type,
  `useTheme`, `recharts`, `lib/supabase/client` (`createTenantClient`),
  `_lib/platformBalance` (`computePending`), `lib/utils/fetchEarliestYear`.

## `_lib/` — pure helpers for the Overview page

Both modules below are pure (no React/Supabase/Redux) and have a colocated
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
  `computePlatformBalance()` in `page.tsx`) rather than reduced from raw
  payout rows.
- `fetchAllRows` (`src/lib/utils/fetchAllRows.ts`) is **no longer used by this
  page** as of the 2026-09-17 RPC rewire — `page.tsx` now fetches
  pre-aggregated JSON via 4 `supabase.rpc(...)` calls instead of paging
  through raw `sales`/`expenses`/`purchases`/`platform_payouts` rows, so the
  "Max Rows" gotcha below no longer applies here. It's still used by the
  Sales/Expenses/Purchases CSV-export queries — see its bullet in the repo
  root `AGENTS.md`'s shared `src/lib/*` list.
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
