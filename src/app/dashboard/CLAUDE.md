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
  Additionally, when `tenant_schema` is present, fetches the tenant's `plan`
  from `control.tenants` via `createControlClient()` and passes it to
  `<StoreProvider>` as `tenantPlan` (hydrated into
  `currentUserSlice.tenantPlan`, read by the Integrations page for plan
  gating via `hasPlatformIntegrations`). The `platform_connections` select
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
  whenever the date-range filter changes, it fetches all four tables
  directly via `createTenantClient()` (`.select("*").order("date", {
  ascending: false }).limit(5000)`, plus `.gte`/`.lte` when a range is
  selected — same shape as the CSV-export queries in Sales/Expenses/
  Purchases), into **local `useState`**, not a Redux slice (page-only data,
  no other feature needs it). `isLoading` drives the same "opacity-60
  pointer-events-none" overlay convention used by the paginated list pages.
  Applies a user-controlled date-range filter (`resolveDateRange` from
  `lib/utils/filters`, preset + custom from/to) on top of the already
  range-scoped fetch, derives `effectiveSales = periodSales.filter(isRevenueSale)`
  (canonical predicate from `lib/utils/filters` — excludes `status === "returned"`
  AND `status === "cancelled"`) and renders:
  - 5 `StatCard`s: Revenue, Expenses, Purchases, Net Profit, Orders (sale count +
    units sold) — grid expands to `lg:grid-cols-5`. Revenue, Net Profit, VAT
    Collected, monthly trend revenue, Revenue by Platform, and Top Products all
    use `effectiveSales` (returned and cancelled orders excluded) — only the
    "Orders" StatCard's count uses the unfiltered `periodSales.length` (total
    orders placed, including returns/cancellations).
  - Revenue sums `total_amount + (shipping_charged ?? 0)` per effective sale;
    costs deduct `(shipping_cost ?? 0) + (advertising_fee ?? 0)` before
    calling `calculateNetProfit`.
  - Multi-currency guard: `periodSales`/`periodExpenses`/`periodPurchases` are
    pre-filtered to `s.currency === profileCurrency` so EUR + USD are never
    summed into a single meaningless number.
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
    Balance Earned, Transferred, Pending. Platform balance cards also compute
    `transferred` (sum of `periodPayouts` for the platform) and
    `pending = balance − transferred`. A "Record Transfer" button
    (admin/super_admin only) opens `RecordTransferModal`
    (`_components/RecordTransferModal.tsx`). `periodPayouts` is filtered from
    the locally-fetched `payouts` state by currency + date range.
  Chart colours adapt to dark/light theme via `useTheme()` — hardcoded hex values
  are passed to recharts props (CSS variables don't render reliably inside SVG).
  No `_components`/`_store` of its own — but see `_lib/` below.
  Shared deps:
  `StatCard`, `CategoryBadge`, `formatCurrency`/`calculateNetProfit`,
  `resolveDateRange`, `ExpenseCategory` type, `useTheme`, `recharts`,
  `lib/supabase/client` (`createTenantClient`).

## `_lib/` — pure helpers for the Overview page

`page.tsx` does its aggregation in local `useState`, not Redux, so the maths has
nowhere to live except here. Both modules are pure (no React/Supabase/Redux) and
have a colocated test — `npx jest dashboard/_lib`. Keep new Overview maths in
this shape: extracting it is what makes it testable without rendering the page.

- `aggregateSales.ts` — `aggregateSaleRevenue(sales) → { revenue, fees }`.
  Filters through `isRevenueSale` first (so returned/cancelled orders are
  excluded — see `lib/utils/filters.ts`), then sums
  `total_amount + (shipping_charged ?? 0)` into `revenue` and
  `(shipping_cost ?? 0) + (advertising_fee ?? 0)` into `fees`.
- `platformBalance.ts` — `computePending(balance, periodPlatformPayouts) → number`.
  Subtracts recorded payouts from a **pre-computed** balance; the caller is
  responsible for filtering payouts by date range and platform first.

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

## Shared shell components (live outside, in `src/components/layout/`)

`DashboardShell` (header, user menu, theme toggle, impersonation banner —
forwards `isPlatformAdmin` to `Sidebar`), `Sidebar` (nav + role-based links +
collapse; renders an "Admin Panel" link to `/admin` when
`role === "super_admin" && isPlatformAdmin`), `PageHeader` (page
title/description/actions row used by every feature page).

## Cross-cutting state & infra

`src/store/{store.ts,hooks.ts,StoreProvider.tsx}` + the two genuinely shared
slices `auditLogsSlice`/`currentUserSlice` in `src/store/slices/`. See
`AGENTS.md` (repo root) → "Project structure" for the full
shared-vs-feature-private map.
