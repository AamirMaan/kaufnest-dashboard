# Overview Chart Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overview page's StatCard grid and ad-hoc sections with per-category chart cards backed by one new monthly-timeseries RPC.

**Architecture:** A new `get_overview_timeseries` Postgres function (migration 051) returns zero-filled monthly buckets, previous-period totals and the top purchase vendor as one `jsonb`. The page keeps the four existing 045 RPCs for headline totals, adds this fifth call, and hands the results to pure helpers (`_lib/overviewCharts.ts`) that shape recharts series. Each card is a thin component on top of a shared `ChartCard` shell.

**Tech Stack:** Postgres (`LANGUAGE sql STABLE`), Supabase RPC, React 19, recharts 3, Jest.

Spec: `docs/superpowers/specs/2026-09-26-summary-tiles-receipt-autofill-overview-charts-design.md` → Part 3.

## Global Constraints

- Migration number is **051** (`050` is the last on `main`). Tenant DDL goes through `public.run_on_all_tenant_schemas` **and** is mirrored into `provision_tenant_schema()` in `005_tenant_provisioning.sql`, placed after the 050 summary block and **before** the `── 9. Advanced inventory` installer, which must stay last.
- The function is **not** `SECURITY DEFINER` — it runs as the caller so RLS applies, like 045/050.
- The `005` copy lives inside `format($sql$ … $sql$, schema_name)`, so the body must contain **no literal `%`**.
- Returned/cancelled orders are excluded from revenue, fees and VAT; `orders` counts every order, same as the existing Orders StatCard.
- Revenue formula is `total_amount + coalesce(shipping_charged, 0)` (045's `monthlyRevenue`/`revenue`); fees are `shipping_cost + advertising_fee + platform_fee` (045's `fees`). Net profit = revenue − (expenses + fees) − purchases, same as today's page.
- Never apply migration 051 to the live DB without the user's explicit go-ahead.
- Cards are display-only (no click-through). One exception kept from today: the admin-only "Record Transfer" button on the eBay/Amazon balance cards.
- No `any`, no `@ts-ignore`. recharts props need concrete hex colors (CSS vars don't resolve in SVG attributes) — keep the theme-derived palette.
- Empty state text: `No data in this period`.
- Same-commit docs: `src/app/dashboard/{CLAUDE,SKILL}.md`, `supabase/{CLAUDE,SKILL}.md`.

**Deviation from spec (recorded here and in the spec):** each month also carries `fees` (sale fees), and `previous` also carries `fees`, so the Net Profit line and headline use the same formula the page already uses. The spec's `revenue − expenses − purchases` omitted fees, which would make the line disagree with the headline.

---

### Task 1: Migration 051 + 005 mirror + integration test

**Files:**
- Create: `supabase/migrations/051_overview_timeseries.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (insert before `-- ── 9. Advanced inventory`)
- Create: `src/app/dashboard/_lib/overviewTimeseries.integration.test.ts`
- Modify: `supabase/CLAUDE.md`, `supabase/SKILL.md` (file-map row: 051 — ⏳ not applied)

**Produces:** RPC `get_overview_timeseries(p_from date, p_to date, p_currency text) RETURNS jsonb`:

```
{ "months": [ { "month": "YYYY-MM", "revenue_by_platform": {platform: n},
                "orders": n, "returned_cancelled": n, "fees": n,
                "expenses_by_category": {category: n}, "expenses": n,
                "purchases": n, "units": n, "vat_collected": n, "vat_paid": n } ],
  "previous": { "revenue": n, "expenses": n, "purchases": n, "orders": n, "fees": n } | null,
  "top_vendor": { "name": text, "amount": n } | null }
```

Month span: `[month(p_from), month(p_to)]`. An open side falls back to the earliest/latest dated row in any of the three tables (in `p_currency`), and to the other bound when there's no data. No data and no bounds → `"months": []`. `previous` = the equal-length window right before `[p_from, p_to]`, `null` if either bound is null. `top_vendor` = purchase vendor (non-blank) with the largest `sum(total_amount)` in range, tie → alphabetical.

- [ ] Write the function body once (used verbatim in both files, `{{schema}}` vs `%1$I`):

```sql
CREATE OR REPLACE FUNCTION {{schema}}.get_overview_timeseries(p_from date, p_to date, p_currency text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = {{schema}}
AS $func$
  WITH s AS (
    SELECT *, status NOT IN ('returned', 'cancelled') AS effective
    FROM sales
    WHERE currency = p_currency
      AND (p_from IS NULL OR date >= p_from)
      AND (p_to IS NULL OR date <= p_to)
  ),
  e AS (
    SELECT * FROM expenses
    WHERE currency = p_currency
      AND (p_from IS NULL OR date >= p_from)
      AND (p_to IS NULL OR date <= p_to)
  ),
  p AS (
    SELECT * FROM purchases
    WHERE currency = p_currency
      AND (p_from IS NULL OR date >= p_from)
      AND (p_to IS NULL OR date <= p_to)
  ),
  bounds AS (
    SELECT
      date_trunc('month', coalesce(p_from, least(
        (SELECT min(date) FROM s), (SELECT min(date) FROM e), (SELECT min(date) FROM p), p_to
      )))::date AS lo,
      date_trunc('month', coalesce(p_to, greatest(
        (SELECT max(date) FROM s), (SELECT max(date) FROM e), (SELECT max(date) FROM p), p_from
      )))::date AS hi
  ),
  months AS (
    SELECT to_char(m, 'YYYY-MM') AS month
    FROM bounds, generate_series(bounds.lo, bounds.hi, interval '1 month') AS m
  ),
  sales_platform AS (
    SELECT to_char(date, 'YYYY-MM') AS month, platform,
           sum(total_amount + coalesce(shipping_charged, 0)) AS amount
    FROM s WHERE effective
    GROUP BY 1, 2
  ),
  sales_month AS (
    SELECT to_char(date, 'YYYY-MM') AS month,
           count(*) AS orders,
           count(*) FILTER (WHERE NOT effective) AS returned_cancelled,
           coalesce(sum(coalesce(shipping_cost, 0) + coalesce(advertising_fee, 0) + coalesce(platform_fee, 0))
                    FILTER (WHERE effective), 0) AS fees,
           coalesce(sum(coalesce(vat_amount, 0)) FILTER (WHERE effective), 0) AS vat
    FROM s
    GROUP BY 1
  ),
  expense_category AS (
    SELECT to_char(date, 'YYYY-MM') AS month, category, sum(amount) AS amount
    FROM e
    GROUP BY 1, 2
  ),
  expense_month AS (
    SELECT to_char(date, 'YYYY-MM') AS month, sum(amount) AS amount,
           sum(coalesce(vat_amount, 0)) AS vat
    FROM e
    GROUP BY 1
  ),
  purchase_month AS (
    SELECT to_char(date, 'YYYY-MM') AS month, sum(total_amount) AS amount,
           sum(quantity) AS units, sum(coalesce(vat_amount, 0)) AS vat
    FROM p
    GROUP BY 1
  ),
  prev AS (
    SELECT p_from - (p_to - p_from + 1) AS pf, p_from - 1 AS pt
    WHERE p_from IS NOT NULL AND p_to IS NOT NULL
  )
  SELECT jsonb_build_object(
    'months', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'month', m.month,
        'revenue_by_platform', coalesce((
          SELECT jsonb_object_agg(sp.platform, sp.amount) FROM sales_platform sp WHERE sp.month = m.month
        ), '{}'::jsonb),
        'orders', coalesce(sm.orders, 0),
        'returned_cancelled', coalesce(sm.returned_cancelled, 0),
        'fees', coalesce(sm.fees, 0),
        'expenses_by_category', coalesce((
          SELECT jsonb_object_agg(ec.category, ec.amount) FROM expense_category ec WHERE ec.month = m.month
        ), '{}'::jsonb),
        'expenses', coalesce(em.amount, 0),
        'purchases', coalesce(pm.amount, 0),
        'units', coalesce(pm.units, 0),
        'vat_collected', coalesce(sm.vat, 0),
        'vat_paid', coalesce(em.vat, 0) + coalesce(pm.vat, 0)
      ) ORDER BY m.month), '[]'::jsonb)
      FROM months m
      LEFT JOIN sales_month sm ON sm.month = m.month
      LEFT JOIN expense_month em ON em.month = m.month
      LEFT JOIN purchase_month pm ON pm.month = m.month
    ),
    'previous', (
      SELECT jsonb_build_object(
        'revenue', (SELECT coalesce(sum(total_amount + coalesce(shipping_charged, 0)), 0) FROM sales
                    WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt
                      AND status NOT IN ('returned', 'cancelled')),
        'fees', (SELECT coalesce(sum(coalesce(shipping_cost, 0) + coalesce(advertising_fee, 0) + coalesce(platform_fee, 0)), 0) FROM sales
                 WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt
                   AND status NOT IN ('returned', 'cancelled')),
        'orders', (SELECT count(*) FROM sales
                   WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt),
        'expenses', (SELECT coalesce(sum(amount), 0) FROM expenses
                     WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt),
        'purchases', (SELECT coalesce(sum(total_amount), 0) FROM purchases
                      WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt)
      )
      FROM prev
    ),
    'top_vendor', (
      SELECT jsonb_build_object('name', v.vendor, 'amount', v.amount)
      FROM (
        SELECT vendor, sum(total_amount) AS amount
        FROM p
        WHERE nullif(btrim(vendor), '') IS NOT NULL
        GROUP BY vendor
        ORDER BY sum(total_amount) DESC, vendor
        LIMIT 1
      ) v
    )
  );
$func$;

GRANT EXECUTE ON FUNCTION {{schema}}.get_overview_timeseries(date, date, text) TO authenticated;
```

- [ ] Wrap it in `SELECT public.run_on_all_tenant_schemas($$ … $$);` with a header comment in the style of 050.
- [ ] Mirror into 005 as `EXECUTE format($sql$ … $sql$, schema_name);` + `EXECUTE format('GRANT EXECUTE … %1$I.get_overview_timeseries(date, date, text) TO authenticated', schema_name);`. `grep -c '%' ` on the new 005 block must only match the `%1$I` placeholders.
- [ ] Integration test (runs only via `npm run test:integration`, after 051 is applied): insert into `tenant_boughtopia` 1 shipped sale (Jan 2001, total 100, shipping_charged 10, platform_fee 5, vat 19), 1 returned sale (Jan 2001, total 50), 1 expense (Feb 2001, 30, category `software`, vat 5), 1 purchase (Feb 2001, 40, qty 2, vendor marker); call with `2001-01-01..2001-03-31`; assert 3 months (`2001-01..03`), Jan revenue_by_platform `{other: 110}`, orders 2, returned_cancelled 1, fees 5, vat_collected 19; Feb expenses 30, purchases 40, units 2, vat_paid 5; Mar all zero; `previous` present (all zeros for 2000-10-02..2000-12-31 is not guaranteed — assert only that the keys exist); top_vendor name = marker. Clean up in `afterAll`.
- [ ] Docs: 051 row in `supabase/SKILL.md` file map (⏳ **not applied**), bullet in `supabase/CLAUDE.md`.
- [ ] Commit `feat(overview): get_overview_timeseries RPC (051)`.

### Task 2: Pure chart helpers + palette + platform balance extraction

**Files:**
- Create: `src/app/dashboard/_lib/overviewTypes.ts` (moved `SalesOverview`/`ExpensesOverview`/`PurchasesOverview`/`PayoutsOverview` interfaces from `page.tsx` + new `OverviewTimeseries`, `OverviewMonth`, `PlatformBalance`)
- Create: `src/app/dashboard/_lib/overviewCharts.ts` + `.test.ts`
- Create: `src/app/dashboard/_lib/chartPalette.ts` + `.test.ts`
- Modify: `src/app/dashboard/_lib/platformBalance.ts` + `.test.ts` (move `computePlatformBalance` out of `page.tsx`)

**Produces:**
- `pctChange(cur: number, prev: number | null | undefined): number | null` — null when prev is missing or 0.
- `changeTone(pct: number | null, goodWhen: "up" | "down"): "good" | "bad" | "neutral"` — neutral for null/0.
- `formatPct(pct: number): string` — `+12.3%` / `−4.0%` (U+2212) / `0.0%`.
- `margin(profit: number, revenue: number): number | null` — null when revenue ≤ 0.
- `monthLabel(ym: string): string` — `"2026-01"` → `"Jan 26"` (fixed English month names, no locale dependence).
- `sumMonths(months, field: NumericMonthField): number`.
- `stackedSeries(months, key: "revenue_by_platform" | "expenses_by_category"): { keys: string[]; rows: { label: string; values: Record<string, number> }[] }` — keys ordered by period total desc (then name), every row has every key (0-filled).
- `netProfitSeries(months): { label: string; value: number }[]` — per month `Σrevenue_by_platform − fees − expenses − purchases`.
- `bestWorstMonth(series: { label: string; value: number }[]): { best: {label,value}; worst: {label,value} } | null` — null when fewer than 2 points; first wins ties.
- `topCategoryShare(byCategory: {category: string; amount: number}[], total: number): { category: string; amount: number; share: number } | null` — share % of total; null when empty or total ≤ 0.
- `returnRate(orders: number, returnedCancelled: number): number | null` — %; null when orders = 0.
- `balanceBars(b: PlatformBalance): { name: string; value: number; tone: "positive" | "negative" | "neutral" | "pending" }[]` — Sales, Fees (ad + shipping), Expenses, Transferred, Pending.
- `chartPalette.ts`: `PLATFORM_COLORS`, `CATEGORY_COLORS`, `seriesColor(key: string, index: number): string`, `chartTheme(isDark: boolean): { grid; tick; tooltipBg; tooltipBorder; tooltipLabel; positive; negative; neutral; pending; primary }`, `compactMoney(value: number, currency: string): string` (Intl `en`, `notation: "compact"`, max 1 fraction digit).
- `computePlatformBalance(platform, sales, expenses, payouts)` — unchanged behavior, now exported from `platformBalance.ts`.

- [ ] Write tests first for every helper (edge cases: prev 0, empty months, negative expenses, single month, tie ordering, unknown platform color falls back deterministically, balance null when no bucket).
- [ ] Implement, run `npx jest dashboard/_lib`, commit `feat(overview): chart helpers and palette`.

### Task 3: ChartCard + category cards

**Files (all `src/app/dashboard/_components/`):**
- `ChartCard.tsx` — props `{ title; headline: string; change?: number | null; goodWhen?: "up" | "down"; meta?: ReactNode; action?: ReactNode; empty?: boolean; children }`. Card classes copied from today's `cardCls` + `--shadow-card`; heading `text-sm font-semibold`, headline `text-2xl font-bold tabular-nums`, change badge `▲/▼ formatPct` in `--color-success`/`--color-danger`/muted, meta `text-xs text-(--color-text-muted)`, chart area `h-[220px]`, empty → centered `No data in this period`.
- `useChartTheme.ts` — `useTheme()` → `chartTheme(isDark)`; plus `tooltipStyle(theme)` returning `contentStyle`/`labelStyle`.
- `RevenueCard.tsx`, `ExpensesCard.tsx`, `PurchasesCard.tsx`, `NetProfitCard.tsx`, `OrdersCard.tsx`, `PlatformBalanceCard.tsx`, `VatCard.tsx`, `TopProductsCard.tsx` — each takes already-fetched data + `currency`, calls the Task 2 helpers, renders a recharts chart inside `ChartCard`. Tooltips use `formatCurrency`; Y axes use `compactMoney`.

| Card | Headline / change | Chart | Meta |
| --- | --- | --- | --- |
| Revenue | `salesOverview.revenue`, Δ vs `previous.revenue` (up good) | stacked bars by platform | AOV (revenue / effectiveOrderCount), effective order count |
| Net Profit | revenue − (expenses + fees) − purchases | line (`netProfitSeries`) | margin %, best / worst month |
| Expenses | `expensesOverview.total`, Δ (down good) | stacked bars by category (labels via `CATEGORY_LABELS`) | top category + share |
| Purchases | `purchasesOverview.total`, Δ (down good) | monthly bars | units bought, top vendor |
| Orders | `salesOverview.orderCount`, Δ vs `previous.orders` (up good) | monthly bars | returned/cancelled rate, units sold |
| VAT Position | abs(collected − paid), label "Due" / "Refund" | grouped bars collected vs paid | collected · paid |
| eBay / Amazon Balance | balance earned | horizontal bars (`balanceBars`) | order count, pending; Record Transfer action (admin) |
| Top Products | top product revenue | horizontal bars top 5 | units in tooltip |

- [ ] Commit `feat(overview): chart cards`.

### Task 4: Rewire page.tsx + docs

**Files:** `src/app/dashboard/page.tsx`, `src/app/dashboard/CLAUDE.md`, `src/app/dashboard/SKILL.md`, spec (fees deviation note).

- [ ] Fetch `get_overview_timeseries` in the same `Promise.all` (5 RPCs); store `timeseries` in local state.
- [ ] RPC params from `resolveDateBounds({ preset, dateFrom, dateTo })` instead of `range?.from` — fixes one-sided custom ranges sending the `0000-00-00`/`9999-99-99` sentinels as SQL dates.
- [ ] Remove the StatCard grid, platform-balance sections, Monthly Trend, Platform donut, VAT section, Top Products and Expenses-by-Category blocks; render the cards in `grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8`. Keep date filter, loading overlay, Quick Start (fix its hard-coded "EUR" to `profileCurrency`), `RecordTransferModal`.
- [ ] Update docs (file map, data flow, gotchas: 5th RPC, fees in net profit, month labels, sentinel fix).
- [ ] Commit `feat(overview): chart-card Overview page`.

### Final

- [ ] Whole-branch review (most capable model), fix, push, open PR. Tell the user 051 needs applying before the page works (the page degrades to empty charts + headlines if the RPC is missing).
