# Analytics

Route: `/dashboard/analytics`. The detailed drill-down page split off Home
(`dashboard/page.tsx`) on 2026-09-27 — Home kept the 4 KPI tiles + trend
chart + platform donut + recent orders, and this page kept the picked-range
KPI tiles plus every per-metric detail card, plus the Record Transfer admin
gate.

## Files in this folder

- `page.tsx` — its own `useDateRangePicker()` instance (NOT shared with
  Home — see `SKILL.md`'s gotcha), feeding `useOverviewData()` for the
  picked-range aggregates and the trailing-12-month sparkline series. Renders
  4 `KpiTile`s (Revenue, Net Profit, Purchases, and a VAT tile that swaps its
  label between "VAT payable"/"VAT refundable" depending on sign and has no
  delta), then a `grid-cols-1 lg:grid-cols-2` grid of `RevenueCard` /
  `NetProfitCard` / `ExpensesCard` / `PurchasesCard` / `OrdersCard` /
  `VatCard` / `PlatformBalanceCard` (rendered once per platform — eBay,
  Amazon — each hidden when that platform had no sales in the period) /
  `TopProductsCard`. An admin/super_admin additionally sees a "Record
  Transfer" action on each `PlatformBalanceCard`, which opens
  `RecordTransferModal`.

That's the whole folder — **every component and every `_lib` helper this
page uses lives in `../_components` and `../_lib`** (the Overview family
documented in `dashboard/CLAUDE.md`: `ChartCard`, `useChartKit`,
`useOverviewData`, `useDateRangePicker`/`DateRangePicker`, `kpiTiles`,
`platformBalance`, `overviewCharts`, `chartPalette`, `overviewTypes`, and
every `*Card.tsx`). This folder owns no private component or lib code of its
own — don't add an `_components/`/`_lib/` here; extend the shared ones in
`dashboard/` instead.

Test command: `npx jest src/app/dashboard/_lib` — there's no analytics-only
test, since all the logic this page renders is defined and tested in
`dashboard/_lib`.
