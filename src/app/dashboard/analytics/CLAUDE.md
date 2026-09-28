# Analytics

Route: `/dashboard/analytics`. **Every chart lives here; the numbers live on
Home** (`dashboard/page.tsx`) — split settled 2026-09-28. Home owns the KPI
tiles, the per-platform stat cards (with the Record Transfer admin action)
and recent orders.

## Files in this folder

- `page.tsx` — its own `useDateRangePicker()` instance (NOT shared with
  Home — see `SKILL.md`'s gotcha), feeding `useOverviewData()`. Renders
  `OverviewTrendCard` (last 12 months, Revenue/Orders/Profit, spans 2 of 3
  `xl` columns) next to `PlatformDonutCard`, then a `grid-cols-1
  lg:grid-cols-2` grid of `RevenueCard` / `NetProfitCard` / `ExpensesCard` /
  `PurchasesCard` / `OrdersCard` / `VatCard` / `PlatformBalanceCard` (chart
  only, no Record Transfer — rendered once per platform, eBay/Amazon, each
  hidden when that platform had no sales) / `TopProductsCard` /
  `MarketplaceCard` (2026-09-28 — revenue/VAT/VAT-base ranked table per
  marketplace, from `get_sales_by_marketplace`). No KPI tiles.

That's the whole folder — **every component and every `_lib` helper this
page uses lives in `../_components` and `../_lib`** (the Overview family
documented in `dashboard/CLAUDE.md`: `ChartCard`, `useChartKit`,
`useOverviewData`, `useDateRangePicker`/`DateRangePicker`, `platformShare`,
`platformBalance`, `overviewCharts`, `chartPalette`, `overviewTypes`, and
every `*Card.tsx`). This folder owns no private component or lib code of its
own — don't add an `_components/`/`_lib/` here; extend the shared ones in
`dashboard/` instead.

Test command: `npx jest src/app/dashboard/_lib` — there's no analytics-only
test, since all the logic this page renders is defined and tested in
`dashboard/_lib`.
