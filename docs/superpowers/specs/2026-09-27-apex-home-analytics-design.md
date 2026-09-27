# Apex-style Home + Analytics — design

**Date:** 2026-09-27
**Reference:** https://apex-shadcn.dashboardpack.com/ (home) and `/analytics`

## Context

The user finds the Overview page (`/dashboard`, 9 chart cards in a 2-column
grid since PR #115) cluttered. They want Apex's structure: a quick-glance home
page of stat tiles and one chart, and a separate Analytics page for the detail.

**Scope decisions made with the user:**

- **Keep the existing theme.** Colours, dark mode (violet primary), the sidebar
  and the tokens in `globals.css` are all unchanged. Only layout and components
  follow Apex. (An earlier theme-reskin spec was dropped; it is on the unpushed
  branch `feat/apex-theme-reskin`.)
- **Tiles show % change vs the previous period.**
- **Home keeps its date picker.** Tiles follow the picked range; sparklines
  always show the trailing 12 months so they are a real trend even for "This
  month".
- **Orders table restyle is a separate, later PR** (not in this spec).

## Data — no new RPCs, no migration

Everything comes from the existing RPCs:

| Need | Source |
| --- | --- |
| Headline totals | `get_sales_overview` / `get_expenses_overview` / `get_purchases_overview` / `get_payouts_overview` (045) for the picked range |
| Monthly series + previous-period totals | `get_overview_timeseries` (051) for the picked range. `previous` is null for open ranges ("All time", one-sided custom), so deltas hide. |
| Sparklines, Home Overview chart | **one extra** `get_overview_timeseries` call for the trailing 12 months (first day of the month 11 months ago → today), independent of the picker |
| Recent Orders | direct `sales` select: `.order("date", desc).order("created_at", desc).limit(5)`. The bound is `RECENT_ORDERS_LIMIT = 5`, a structural constant, not business growth. It deliberately does not read the Redux `sales` slice, which holds whichever page the Orders page last fetched. |

Previous-period net profit = `previous.revenue − previous.fees −
previous.expenses − previous.purchases`, the same formula as
`netProfitSeries`/`calculateNetProfit`.

## Components

All new files sit in `src/app/dashboard/_components/` (React) and
`src/app/dashboard/_lib/` (pure logic, tested), next to the #115 chart cards.

### Shared

- **`_components/useDateRangePicker.ts`** — extracts page.tsx's picker state: preset,
  from/to, period mode, earliest-year lookup, `range`, `bounds` and handlers.
  Each page owns its own instance; the default is "This month".
- **`_components/DateRangePicker.tsx`** — the picker markup currently inline in
  page.tsx's `PageHeader` action, fed by the hook.
- **`_components/useOverviewData.ts`** — the 5-RPC load effect moved out of
  page.tsx, plus the trailing-12-month timeseries call. Returns `{ sales,
  expenses, purchases, payouts, timeseries, trailing, isLoading }`. Cancellation
  and error logging are unchanged.
- **`_components/KpiTile.tsx`** — the Apex stat tile, built from existing
  tokens only:
  - label (`text-sm` muted), big value (`text-2xl font-bold tabular-nums`),
    and a tinted icon chip (`bg-(--color-primary-muted)
    text-(--color-primary-text)`, `lucide-react` icon) top-right;
  - a delta line with `TrendingUp`/`TrendingDown` + `formatPct`, coloured by
    `changeTone(pct, goodWhen)`, then "vs previous period" in faint text.
    Hidden when the delta is null;
  - an edge-to-edge sparkline strip at the bottom: recharts `AreaChart` with no
    axes/grid/tooltip, stroke = the tile's colour, gradient fill to
    transparent, ~56px tall. Hidden when there are fewer than 2 points.
  - `rounded-[var(--radius-card)]`, `border-(--color-border)`,
    `var(--shadow-card)`, `overflow-hidden` so the sparkline bleeds to the
    card edges.
- **`_lib/kpiTiles.ts`** (pure) — `buildKpis(input)` returns `{ value, delta,
  spark: number[] }` for revenue, netProfit, orders, expenses, purchases and
  vatPosition from the overview objects + `timeseries.previous` + `trailing`.
  Spark series come from `trailing.months` (revenue = sum of
  `revenue_by_platform`; net profit via `netProfitSeries`; orders; expenses;
  purchases; vat = `vat_collected − vat_paid`).

### Home (`src/app/dashboard/page.tsx`)

Page title stays "Overview"; the sidebar label is unchanged.

1. `PageHeader` with the description and `DateRangePicker` — same as today.
2. **KPI row** — `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4`:
   Revenue (`DollarSign`, good up), Net Profit (`TrendingUp`, good up), Orders
   (`ShoppingCart`, good up), Expenses (`Receipt`, good **down**).
3. **Row 2** — `grid grid-cols-1 xl:grid-cols-3 gap-4`:
   - **`OverviewTrendCard`** (xl: `col-span-2`) — title "Overview", subtitle
     "Last 12 months", and a segmented control (Revenue / Orders / Profit;
     pill group styled like Apex: `bg-(--color-surface-subtle)` track, active
     segment `bg-(--color-surface)` + border + shadow). Smooth `type="monotone"`
     area with gradient fill, dashed horizontal grid only, compact money axis
     (`kit.compact`; plain integers for Orders). Data = `trailing.months`.
   - **`PlatformDonutCard`** — "Revenue by Platform", subtitle = the range
     description. Recharts `PieChart` donut (inner radius ~70%) with the total
     in the centre (compact money + "Revenue" caption), and a legend list:
     dot, platform name, % right-aligned. Data = `sales.revenueByPlatform` via
     `_lib/platformShare.ts`. Colours from the existing `seriesColor()`.
     Empty state: "No sales in this period".
4. **`RecentOrdersCard`** — full width. Header "Recent Orders" / "Latest 5
   orders" + a "View all ↗" link (`ArrowUpRight`) to `/dashboard/sales`. Table
   rows: initials avatar (the `--color-avatar-N` palette hashed by name) +
   buyer name (falls back to the platform label) with the product underneath
   in muted text; `PlatformBadge`; `StatusBadge`; date (`formatDate`); amount
   right-aligned (`formatCurrency(total_amount, currency)`). The whole row links
   to `/dashboard/sales/[id]`. Empty: "No orders yet". This card has its own
   small loading state.
5. **Quick Start** — unchanged, at the bottom.

The detailed #115 cards (Revenue/NetProfit/Expenses/Purchases/Orders/VAT/
PlatformBalance/TopProducts) leave Home.

### Analytics (`src/app/dashboard/analytics/page.tsx`, new feature folder)

- New sidebar `NavItem` directly after Overview: `{ label: "Analytics", href:
  "/dashboard/analytics", Icon: BarChart3, roles: ["super_admin", "admin",
  "accountant"] }` (same roles as Overview). No permission change needed:
  `canAccessRoute` (`lib/utils/permissions.ts`) only restricts `/users` and
  `/audit-logs` and allows every other `/dashboard/*` route.
- Header "Analytics" / "Detailed performance for {range}" + `DateRangePicker`.
- KPI row (4 tiles): Revenue, Net Profit, Purchases (good down), VAT position
  (neutral tone, label "VAT payable"/"VAT refundable" by sign).
- The existing detail cards, moved as-is from Home into a `grid grid-cols-1
  lg:grid-cols-2 gap-4`: RevenueCard, NetProfitCard, ExpensesCard,
  PurchasesCard, OrdersCard, VatCard, eBay + Amazon PlatformBalanceCard
  (Record Transfer + `RecordTransferModal` move with them, same admin gate).
- **TopProductsCard restyled** into an Apex "Top Pages"-style table: rank #,
  product, units, revenue (right-aligned), and a thin share-of-revenue bar
  under each product name (`bg-(--color-primary)` on a
  `bg-(--color-border-subtle)` track). Replaces its horizontal bar chart.
- **`ChartCard` polish** (applies to every detail card): `p-6` stays, heading
  goes to `text-base font-semibold text-(--color-text-strong)` per the type
  scale, add `var(--shadow-card)`, and the grid becomes dashed with no vertical
  lines (most cards already are).
- Components stay in `dashboard/_components/` (shared by both pages, one
  feature family); `analytics/` holds only `page.tsx`, `CLAUDE.md` and
  `SKILL.md`.

## Loading and errors

- `isLoading` keeps the existing `opacity-60 pointer-events-none` overlay on
  the tile/chart area. On the very first load (all data null), tiles render a
  pulse skeleton (`animate-pulse` blocks) instead of zeros.
- An RPC error is logged (unchanged) and that card shows its empty state. A
  failed trailing call hides the sparklines and the Overview chart shows "No
  data in this period"; the tiles still render from the range data.
- A Recent Orders query error shows an inline "Couldn't load recent orders"
  line. No toast: it is a read, not a mutation.

## Testing

Colocated jest tests for the pure modules:

- `kpiTiles.test.ts` — values from overview objects; delta via `pctChange`
  (null when `previous` is null → "All time"); previous net-profit formula;
  spark series lengths and values from `trailing.months`; VAT position sign;
  everything null-safe when inputs are null (first load / RPC error).
- `platformShare.test.ts` — shares sum to 100 (rounding), sorted desc, zero
  total → empty, negative platform revenue (refund-heavy) clamped to 0.
- `recentOrderDisplay.test.ts` — `initials("Jane Doe") = "JD"`, single
  word → first two letters, empty/null → platform-label initials; avatar
  palette index stable per name.
- `useDateRangePicker` logic stays covered by the existing `filters` /
  `periodRange` tests; the hook only wires state.
- Visual: Playwright (if `npm run dev` is running) of Home and Analytics in
  light and dark, desktop and ~390px wide; otherwise the user checks.

## Docs

- `src/app/dashboard/CLAUDE.md` — file map (new components, `_lib` modules,
  the analytics subfolder), and the Home data-flow now including the
  trailing-12-month call and the Recent Orders query.
- `src/app/dashboard/SKILL.md` — "add a KPI tile" and "move a card between
  Home and Analytics" entries; gotcha: sparklines use the trailing window, not
  the picked range.
- New `src/app/dashboard/analytics/{CLAUDE.md,SKILL.md}`.
- Root `AGENTS.md` feature-folder table — add the Analytics row.

## Out of scope

Orders table restyle (separate PR); theme/colour changes; Apex's goals panel
(no goal data exists); sharing the picked range between Home and Analytics.
