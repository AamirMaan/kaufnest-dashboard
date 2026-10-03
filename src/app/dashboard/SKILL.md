---
name: dashboard-shell
description: Work on the dashboard shell, layout-level data hydration, or the Overview/home page at src/app/dashboard — use when the task spans multiple dashboard features, touches the auth guard/data-fetch in layout.tsx, or is about the Overview stats page (not a single feature like sales/expenses/etc). This folder's `_components/`/`_lib/` also back `/dashboard/analytics` (see `analytics/`).
---

# Working on the Dashboard shell / Overview

If your task is about ONE feature (sales, expenses, purchases, users,
audit-logs, settings), go straight to that feature's folder and its own
`SKILL.md` — don't start here.

Use this folder when the task is about:
- The auth guard or initial data fetch/hydration (`layout.tsx`)
- The Overview/home page stats (`page.tsx`, route `/dashboard`)
- Something that spans multiple features (e.g. "add a new collection that
  every page needs hydrated")

This folder's `_components/` and `_lib/` are also where `/dashboard/analytics`
(`analytics/page.tsx`) gets its data hook, chart cards, and pure helpers from —
see `analytics/CLAUDE.md`/`SKILL.md` for that page's own layout and gotchas.

## Adding a new feature with its own Supabase collection

1. Fetch it in `layout.tsx`'s `Promise.all` and pass it to `<StoreProvider>`.
2. Add the hydrate action + slice registration in `src/store/StoreProvider.tsx`
   and `src/store/store.ts` (see how `sales`/`expenses` are wired for the pattern).
3. Build the feature's own `_components`/`_store` inside its route folder,
   following the structure of `sales/` (the most complete example).
4. Write that feature's `CLAUDE.md`/`SKILL.md` and add a row to the table in
   `dashboard/CLAUDE.md`.

## Home + Analytics changes

`_components/useOverviewData.ts` fetches five RPCs via `createTenantClient()`
in one `Promise.all` scoped to the picked date range: the four 045 aggregates
(`get_sales_overview` / `get_expenses_overview` / `get_purchases_overview` /
`get_payouts_overview`) for headline totals, and 051's
`get_overview_timeseries` for monthly chart series, previous-period totals
and the top vendor. All take `{ p_from, p_to, p_currency }`. A **second,
independent** call to `get_overview_timeseries` fetches a fixed
trailing-12-month window (`trailingRange()` in `_lib/kpiTiles.ts`) and reruns
only when `profileCurrency` changes — this is what feeds every KPI sparkline
and `OverviewTrendCard` (see the gotcha below). That second call has its own
`trailingLoading` flag, separate from the hook's overall `isLoading` (see the
`trailingLoading` gotcha below). Results live in the hook's
own `useState` (NOT Redux — see `dashboard/CLAUDE.md` for why). Both
`dashboard/page.tsx` (Home) and `analytics/page.tsx` call this same hook,
each with its own `useDateRangePicker()` instance.

**Rule of the split (2026-09-28, user's call): Home = numbers, Analytics =
charts.** Home renders 6 `KpiTile`s + "By Platform" `PlatformStatsCard`s +
`RecentOrdersCard` + Quick Start. Analytics renders `OverviewTrendCard` +
`PlatformDonutCard` + a `grid-cols-1 lg:grid-cols-2` grid of the detail chart
cards, and no KPI tiles. Don't put a chart on Home or a stat-tile row on
Analytics. Minimal file set per change:

- **Add a KPI tile** → add the field to `KpiSet` in `_lib/kpiTiles.ts`
  (`buildKpis`) plus a test, then render a `KpiTile` on Home. The sparkline/tile color comes from `useChartKit().colors`.
- **Move a card between Home and Analytics** → both pages read the same
  `useOverviewData()` result, so moving a card is just moving its JSX (and,
  for a `KpiTile`, its `buildKpis()` field) between the two `page.tsx` files —
  no data-layer change needed.
- **New/changed detail card** (Analytics) → `_components/<Name>Card.tsx`
  (built on `ChartCard.tsx` + `useChartKit.ts`), any series shaping in
  `_lib/overviewCharts.ts` + its test, wiring in `analytics/page.tsx`.
- **New figure per month** → `supabase/migrations/05x_*.sql` replacing
  `get_overview_timeseries` (+ the `005_tenant_provisioning.sql` mirror),
  `OverviewMonth` in `_lib/overviewTypes.ts`, the integration test.
- **New per-platform figure on Home** → `_lib/platformStats.ts` (+ test) and
  `_components/PlatformStatsCard.tsx`'s `rows`. If it needs a platform other
  than eBay/Amazon in `platformBalance`, that's a 045 RPC change first.
- **Colors** → `_lib/chartPalette.ts` only.

### Gotcha: "still in account" is a running balance, not a period figure

Money stays in the eBay/Amazon account across periods, so `pending` must
come from `get_platform_running_balance` (054: everything earned minus
everything transferred up to the range end), never from the picked
period's `balance − transferred` — that hid earlier payouts (tenant_kaufnest:
July/August transfers invisible under "This month") and earlier unpaid
earnings. "Balance earned"/"Transferred" rows stay period-scoped and are
labelled "(period)". The same goes for the previous-period comparison:
every preset is a whole-calendar-month range, and 054 compares those
against the previous calendar months — the old equal-length day window
dropped 1 Aug from September's comparison.

### Gotcha: per-platform balance must use the same fee set as Net Profit

Home's Net Profit tile subtracts `get_sales_overview.fees` =
`shipping_cost + advertising_fee + platform_fee`. The per-platform balance
(`computePlatformBalance`, Home's `PlatformStatsCard` + Analytics'
`PlatformBalanceCard`) is built from the RPC's `platformBalance` bucket,
which until migration 053 (2026-09-29) summed only ad fees and shipping —
045 predates 035's `platform_fee`, so a recorded platform fee lowered Net
Profit but not "Balance earned" (tenant_kaufnest, Sept 2026: 235.37 shown
vs 233.12 correct). **When a new per-order cost column is added to
`sales`, add it to BOTH the headline `fees` and the `by_platform` bucket.**
053 also made per-platform `sales`/`revenueByPlatform` include buyer-paid
`shipping_charged` (same formula as `revenue`), retiring 045's items-only
"Formula B" there; `topProducts` stays items-only.

### Gotcha: pass `resolveDateBounds`, not `resolveDateRange`, to the RPCs

`resolveDateRange` fills an open side of a custom range with the
`0000-00-00` / `9999-99-99` sentinels (for string comparison). Those aren't
valid SQL dates — before 2026-09-27 a custom range with only From or only To
set made every Overview RPC fail. `resolveDateBounds` returns `null` for the
open side, which the SQL treats as unbounded. `range` is still used for the
header's description text.

### Gotcha: Net Profit includes sale fees — keep the line and headline in sync

Headline = revenue − (expenses + sale fees) − purchases (`calculateNetProfit`
with `expenses + fees`). The monthly line (`netProfitSeries`) subtracts each
month's `fees` too; that's why 051 returns `fees` per month even though the
original spec's formula left it out. If you change one formula, change both.

### Gotcha: recharts colors and per-bar fills

recharts props are SVG attributes, where CSS variables don't resolve
reliably — colors come from `chartTheme(isDark)` in `_lib/chartPalette.ts`
(hex mirrors of the tokens), via `useChartKit(currency)`. `Cell` is
deprecated in recharts 3 (removed in 4); per-bar colors use the Bar `shape`
prop returning `<Rectangle {...props} fill={colors[props.index]} />` (see
`PlatformBalanceCard.tsx`). Month labels come from `monthLabel()` with fixed
English names, not `toLocaleString`, so tests and SSR are deterministic.

### Gotcha: change badges need a closed range

`previous` in the timeseries is the equal-length window right before
`[p_from, p_to]`, and `null` for "All Time" or a one-sided custom range — the
badges then hide (`pctChange` → null). A previous value of 0 also hides the
badge rather than showing an infinite change.

### Gotcha: sparklines and Home's trend chart use the trailing window, never the picked range

`KpiTile.spark` and `OverviewTrendCard` both read `trailing`
(`useOverviewData`'s second, currency-only-dependent RPC call), not
`timeseries` (the picked-range one). A one-month range would otherwise give
a single-point sparkline/chart with nothing to draw a trend from. If you're
adding a new sparkline-bearing tile, wire it to `trailing.months`, not
`timeseries.months`.

### Gotcha: `trailingLoading` is a separate flag from `isLoading` (2026-09-27)

The trailing call runs in its own effect with no loading flag of its own
until 2026-09-27 — before that fix, `OverviewTrendCard` had no way to tell
"still fetching" apart from "fetched, genuinely empty," so it rendered "No
data in this period" for the entire time the trailing RPC was in flight (and
permanently if it errored). `useOverviewData` now exposes `trailingLoading`:
true on mount, flips false once the trailing call resolves (success OR
error), and flips true again for the duration of a currency-triggered
refetch. `OverviewTrendCard` takes this as its `loading` prop and shows a
pulse skeleton (`h-full rounded-[var(--radius-btn)]
bg-(--color-border-subtle) animate-pulse`) in the 300px chart slot while
true; "No data in this period" only renders once `loading` is false. This is
independent of the page-level `isLoading` (which gates the range-scoped RPCs
and drives the "opacity-60 pointer-events-none" overlay) — don't conflate
the two when adding new loading-dependent UI here.

### Gotcha: `useId()` output must be sanitised before it's used in `url(#…)`

React's `useId()` returns ids containing `:` (e.g. `:r0:`), which is not
valid inside an SVG `url(#…)` gradient reference — a gradient-fill chart
silently renders unfilled if you pass the raw id straight through. Both
`KpiTile.tsx` and `OverviewTrendCard.tsx` strip everything but
`[a-zA-Z0-9_-]` before building the gradient id
(`` `kpi-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}` ``) — copy this pattern
for any new chart with its own `<linearGradient>`.

### Gotcha: `RecentOrdersCard` deliberately bypasses the Redux `sales` slice

It runs its own `.limit(RECENT_ORDERS_LIMIT)` query via `createTenantClient()`
instead of reading `state.sales.items`. The `sales` slice holds whichever
page the Sales list last fetched (any sort/filter), not "the 5 most recent
orders" — reading it here would show stale or wrong rows depending on what a
user last did on the Sales page. Don't "simplify" this by wiring it to the
slice.

### Gotcha: Supabase's PostgREST "Max Rows" setting silently truncates below your `.limit()`

Full explanation, the decision framework for which fetch pattern to use, and
the current audit of other places this bites: `BACKEND_ARCHITECTURE_PRINCIPLES.md`
(sections 1 and Appendix A). Short version: a Supabase project's "Max Rows"
API setting (default 1000) caps every REST request's response at that many
rows regardless of the `.limit()`/`.range()` width requested, no error — use
`@/lib/utils/fetchAllRows`, not a bare `.limit(N)`, for "fetch everything
matching a filter." **Home and Analytics no longer exercise this gotcha at
all** — as of the 2026-09-17 RPC rewire `useOverviewData.ts` fetches
pre-aggregated JSON via `supabase.rpc(...)` instead of paging through raw
rows, so don't be confused if you don't see a `fetchAllRows` call in either
`page.tsx`. The Sales/Expenses/Purchases CSV export queries still go
through it.

### Gotcha: section access is loaded per request in both `layout.tsx` and `proxy.ts`

Access = `get_my_access()` + plan ceiling, loaded per request in both
`layout.tsx` and `proxy.ts`; both fail open to role defaults so the app
keeps working before 055 is applied. `proxy.ts` picks the redirect target
via the pure `deniedRedirect(pathname, section, access, deniedParam)`
helper in `@/lib/permissions/sections` (colocated tests in
`sections.test.ts`) — one hop to an already-accessible page, never a
second redirect. The "No access" toast itself does **not** live on this
page — it's `<DeniedAccessToast>` in `src/components/layout/`, rendered
once by `DashboardShell` (so it fires on whichever dashboard page the
redirect lands on, not just Home) — see that folder's note below.

### Gotcha: Totals RPCs are guarded wrappers since 055

Edit `<name>__impl`, not `<name>` — a migration that `CREATE OR REPLACE`s
`<name>` must re-run `public.install_section_permissions` for every tenant
in the same migration.

### Gotcha: "Specific period" filter — Home/Analytics do NOT use `FilterBar`

Home and Analytics's date filter supports "Specific period" (any
month/quarter/full year) same as Sales/Expenses/Purchases/Audit Logs, but
`_components/useDateRangePicker.ts` + `DateRangePicker.tsx` (extracted
2026-09-27 from what used to be `page.tsx`'s own inline UI) is its own
bespoke component rather than the shared `FilterBar` — see
`components/ui/SKILL.md`'s FilterBar entry for the shared version other
features use. If you change the period-picking logic, check both places.

### Gotcha: plan gates read entitlements via `usePlan()`, never a plan key

Plan gates read `state.currentUser.planEntitlements` via `usePlan()` — null before hydration ⇒ not entitled; upgrade copy comes from `availability()`, never hardcode plan names. `layout.tsx` loads them from the `control.plans` catalog
(`getPlanCatalog()`) and sends them through `toWireEntitlements` (unlimited
`maxUsers` = `-1`, since `Infinity` doesn't survive the RSC boundary);
`StoreProvider` decodes with `fromWireEntitlements`. `tenantPlan` is still
hydrated, but only as the key for display/billing — never gate on it.

## Test command

`npx jest dashboard/_lib` (`aggregateSales`, `platformBalance`,
`overviewCharts`, `chartPalette`, `kpiTiles`, `platformShare`,
`recentOrderDisplay`) + `npx jest lib/utils/fetchAllRows` for the shared
helper itself.

`overviewRpc.integration.test.ts` in the same folder is NOT part of that
run — it's excluded from the default `jest.config.ts` `testMatch` and
picked up only by `jest.integration.config.ts`'s `*.integration.test.ts`
pattern. Run it with `npm run test:integration`. It makes real
insert/rpc/delete calls against `tenant_boughtopia` — see its file header
and `dashboard/CLAUDE.md`'s `_lib` entry for what it verifies and why.

### Gotcha: `.env.local` doesn't reach an integration test the way you'd expect

Jest sets `NODE_ENV=test`, and two of the obvious ways to load env vars for
a Jest test both silently no-op under that:
- `process.loadEnvFile(".env.local")` writes to Node's real environment
  store, but jest's `NodeEnvironment` has already replaced `process.env`
  with a static snapshot object *before* your test file's top-level code
  runs — so the write lands somewhere your test's `process.env` reads never
  see.
- `@next/env`'s `loadEnvConfig()` (the function Next's own docs point you
  to for exactly this — see
  `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`)
  deliberately skips `.env.local` whenever `NODE_ENV === "test"`, precisely
  so tests don't depend on a developer's local secrets. That's the right
  default for most tests, but this one specifically needs a live
  Supabase project's real credentials.

Fix: read the file yourself and parse it with Node's built-in
`util.parseEnv` (same parser `node --env-file` uses, no extra dependency),
then assign into `process.env` directly — a plain
`process.env[key] = value` assignment mutates jest's snapshot object fine,
unlike `loadEnvFile`. See the top of `overviewRpc.integration.test.ts` for
the exact pattern; reuse it verbatim in any future integration test file
rather than re-discovering this.
