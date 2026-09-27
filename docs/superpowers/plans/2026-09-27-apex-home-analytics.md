# Apex-style Home + Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the cluttered Overview into an Apex-style Home (KPI tiles with sparklines + deltas, one trend chart, platform donut, recent orders) and a new `/dashboard/analytics` page that holds the detailed chart cards.

**Architecture:** Pure shaping logic goes in `src/app/dashboard/_lib/` (tested). React pieces go in `src/app/dashboard/_components/`, shared by both pages. The date picker and the RPC loading block are extracted from `page.tsx` into hooks, so Home and Analytics each get their own instance. The existing RPCs are reused, plus one extra `get_overview_timeseries` call for a trailing 12-month window.

**Tech Stack:** Next.js 16 App Router (client pages), React, Tailwind v4 (`bg-(--token)` syntax), recharts 3, lucide-react, Supabase JS, jest + ts-jest (node env).

**Spec:** `docs/superpowers/specs/2026-09-27-apex-home-analytics-design.md`

## Global Constraints

- **Do not change the theme.** No edits to `src/app/globals.css`. Use only the existing `var(--color-*)`/`--radius-*`/`--shadow-card` tokens.
- recharts colours come from `useChartKit(currency).colors` / `seriesColor()`, never from new hex literals.
- No new RPCs and no migrations.
- Don't read the Redux `sales`/`expenses`/`purchases` slices for Home/Analytics data (see `src/app/dashboard/CLAUDE.md`).
- Type scale: page title comes from `PageHeader`; card headings are `text-base font-semibold text-(--color-text-strong)`; body `text-sm`; meta `text-xs`.
- Every icon-only control gets an `aria-label`. Segmented toggles use `aria-pressed`.
- Work on branch `feat/apex-home-analytics` (already created; the spec is committed there).
- Run focused tests with `npx jest src/app/dashboard/_lib`. Don't run `tsc`/`lint` by hand; the pre-commit hook runs them.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: KPI + trend shaping helpers (`kpiTiles.ts`)

**Files:**
- Create: `src/app/dashboard/_lib/kpiTiles.ts`
- Test: `src/app/dashboard/_lib/kpiTiles.test.ts`

**Interfaces:**
- Consumes: `pctChange`, `netProfitSeries`, `monthLabel` from `./overviewCharts`; `calculateNetProfit` from `@/lib/utils/currency`; types from `./overviewTypes`.
- Produces:
  ```ts
  export interface Kpi { value: number; delta: number | null; spark: number[] }
  export interface KpiSet { revenue: Kpi; netProfit: Kpi; orders: Kpi; expenses: Kpi; purchases: Kpi; vatPosition: Kpi }
  export interface KpiInput {
    sales: SalesOverview | null; expenses: ExpensesOverview | null; purchases: PurchasesOverview | null;
    timeseries: OverviewTimeseries | null; trailing: OverviewTimeseries | null;
  }
  export function buildKpis(input: KpiInput): KpiSet
  export type TrendMetric = "revenue" | "orders" | "profit"
  export function trendSeries(months: OverviewMonth[], metric: TrendMetric): { label: string; value: number }[]
  export function trailingRange(today: Date): { from: string; to: string } // YYYY-MM-DD, local time
  export function monthRevenue(m: OverviewMonth): number
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/app/dashboard/_lib/kpiTiles.test.ts
import { buildKpis, monthRevenue, trailingRange, trendSeries } from "./kpiTiles";
import type {
  ExpensesOverview, OverviewMonth, OverviewTimeseries, PurchasesOverview, SalesOverview,
} from "./overviewTypes";

function month(partial: Partial<OverviewMonth> & { month: string }): OverviewMonth {
  return {
    revenue_by_platform: {}, orders: 0, returned_cancelled: 0, fees: 0,
    expenses_by_category: {}, expenses: 0, purchases: 0, units: 0,
    vat_collected: 0, vat_paid: 0, ...partial,
  };
}

const sales = {
  orderCount: 12, effectiveOrderCount: 10, unitsSold: 15, revenue: 1000, fees: 100,
  vatCollected: 190, revenueByPlatform: [], topProducts: [], monthlyRevenue: [], platformBalance: [],
} as SalesOverview;
const expenses = { total: 200, vatPaid: 30, byCategory: [], monthlyExpenses: [], platformSubtotal: [] } as ExpensesOverview;
const purchases = { total: 300, vatPaid: 50, monthlyPurchases: [] } as PurchasesOverview;

const timeseries: OverviewTimeseries = {
  months: [],
  previous: { revenue: 800, expenses: 250, purchases: 300, orders: 10, fees: 50 },
  top_vendor: null,
};

const trailing: OverviewTimeseries = {
  months: [
    month({ month: "2026-08", revenue_by_platform: { ebay: 100, amazon: 50 }, orders: 3, fees: 10, expenses: 20, purchases: 30, vat_collected: 9, vat_paid: 4 }),
    month({ month: "2026-09", revenue_by_platform: { ebay: 200 }, orders: 5, fees: 20, expenses: 40, purchases: 0, vat_collected: 12, vat_paid: 2 }),
  ],
  previous: null,
  top_vendor: null,
};

describe("buildKpis", () => {
  const k = buildKpis({ sales, expenses, purchases, timeseries, trailing });

  it("takes headline values from the range overviews", () => {
    expect(k.revenue.value).toBe(1000);
    expect(k.orders.value).toBe(12);
    expect(k.expenses.value).toBe(200);
    expect(k.purchases.value).toBe(300);
    expect(k.netProfit.value).toBe(1000 - 100 - 200 - 300); // 400
    expect(k.vatPosition.value).toBe(190 - (30 + 50)); // 110
  });

  it("computes deltas against timeseries.previous", () => {
    expect(k.revenue.delta).toBeCloseTo(25); // 1000 vs 800
    expect(k.orders.delta).toBeCloseTo(20); // 12 vs 10
    expect(k.expenses.delta).toBeCloseTo(-20); // 200 vs 250
    expect(k.purchases.delta).toBeCloseTo(0);
    // previous net = 800 - 50 - 250 - 300 = 200 → 400 vs 200 = +100%
    expect(k.netProfit.delta).toBeCloseTo(100);
    expect(k.vatPosition.delta).toBeNull(); // no previous VAT figure exists
  });

  it("builds spark series from the trailing months", () => {
    expect(k.revenue.spark).toEqual([150, 200]);
    expect(k.orders.spark).toEqual([3, 5]);
    expect(k.expenses.spark).toEqual([20, 40]);
    expect(k.purchases.spark).toEqual([30, 0]);
    expect(k.netProfit.spark).toEqual([150 - 10 - 20 - 30, 200 - 20 - 40 - 0]);
    expect(k.vatPosition.spark).toEqual([5, 10]);
  });

  it("hides deltas for open ranges (previous is null)", () => {
    const open = buildKpis({ sales, expenses, purchases, timeseries: { ...timeseries, previous: null }, trailing });
    expect(open.revenue.delta).toBeNull();
    expect(open.netProfit.delta).toBeNull();
  });

  it("is null-safe on first load / RPC errors", () => {
    const empty = buildKpis({ sales: null, expenses: null, purchases: null, timeseries: null, trailing: null });
    expect(empty.revenue).toEqual({ value: 0, delta: null, spark: [] });
    expect(empty.netProfit.value).toBe(0);
  });
});

describe("trendSeries", () => {
  it("maps each metric to labelled monthly values", () => {
    expect(trendSeries(trailing.months, "revenue")).toEqual([
      { label: "Aug 26", value: 150 },
      { label: "Sep 26", value: 200 },
    ]);
    expect(trendSeries(trailing.months, "orders").map((p) => p.value)).toEqual([3, 5]);
    expect(trendSeries(trailing.months, "profit").map((p) => p.value)).toEqual([90, 140]);
  });
});

describe("monthRevenue", () => {
  it("sums all platforms", () => {
    expect(monthRevenue(trailing.months[0])).toBe(150);
  });
});

describe("trailingRange", () => {
  it("spans the first day of the month 11 months back through today", () => {
    expect(trailingRange(new Date(2026, 8, 27))).toEqual({ from: "2025-10-01", to: "2026-09-27" });
  });

  it("crosses year boundaries", () => {
    expect(trailingRange(new Date(2026, 0, 5))).toEqual({ from: "2025-02-01", to: "2026-01-05" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/app/dashboard/_lib/kpiTiles.test.ts`
Expected: FAIL, "Cannot find module './kpiTiles'".

- [ ] **Step 3: Implement**

```ts
// src/app/dashboard/_lib/kpiTiles.ts
/**
 * Pure shaping for the Apex-style KPI tiles and the Home trend chart.
 * Headline values follow the picked range (the 045 overviews + 051
 * `previous`); spark series always come from the trailing-12-month
 * timeseries so a short range ("This month") still shows a real trend.
 */
import { calculateNetProfit } from "@/lib/utils/currency";
import { monthLabel, netProfitSeries, pctChange } from "./overviewCharts";
import type {
  ExpensesOverview, OverviewMonth, OverviewTimeseries, PurchasesOverview, SalesOverview,
} from "./overviewTypes";

export interface Kpi {
  value: number;
  /** % change vs the previous equal-length period; null when there is none. */
  delta: number | null;
  spark: number[];
}

export interface KpiSet {
  revenue: Kpi;
  netProfit: Kpi;
  orders: Kpi;
  expenses: Kpi;
  purchases: Kpi;
  vatPosition: Kpi;
}

export interface KpiInput {
  sales: SalesOverview | null;
  expenses: ExpensesOverview | null;
  purchases: PurchasesOverview | null;
  timeseries: OverviewTimeseries | null;
  trailing: OverviewTimeseries | null;
}

export function monthRevenue(m: OverviewMonth): number {
  return Object.values(m.revenue_by_platform).reduce((a, b) => a + b, 0);
}

export function buildKpis({ sales, expenses, purchases, timeseries, trailing }: KpiInput): KpiSet {
  const revenue = sales?.revenue ?? 0;
  const fees = sales?.fees ?? 0;
  const expenseTotal = expenses?.total ?? 0;
  const purchaseTotal = purchases?.total ?? 0;
  const orders = sales?.orderCount ?? 0;
  const netProfit = calculateNetProfit(revenue, expenseTotal + fees, purchaseTotal);
  const vatPosition = (sales?.vatCollected ?? 0) - ((purchases?.vatPaid ?? 0) + (expenses?.vatPaid ?? 0));

  const prev = timeseries?.previous ?? null;
  const prevNet = prev ? prev.revenue - prev.fees - prev.expenses - prev.purchases : null;

  const months = trailing?.months ?? [];

  return {
    revenue: { value: revenue, delta: pctChange(revenue, prev?.revenue), spark: months.map(monthRevenue) },
    netProfit: {
      value: netProfit,
      delta: pctChange(netProfit, prevNet),
      spark: netProfitSeries(months).map((p) => p.value),
    },
    orders: { value: orders, delta: pctChange(orders, prev?.orders), spark: months.map((m) => m.orders) },
    expenses: { value: expenseTotal, delta: pctChange(expenseTotal, prev?.expenses), spark: months.map((m) => m.expenses) },
    purchases: { value: purchaseTotal, delta: pctChange(purchaseTotal, prev?.purchases), spark: months.map((m) => m.purchases) },
    vatPosition: { value: vatPosition, delta: null, spark: months.map((m) => m.vat_collected - m.vat_paid) },
  };
}

export type TrendMetric = "revenue" | "orders" | "profit";

export function trendSeries(months: OverviewMonth[], metric: TrendMetric): { label: string; value: number }[] {
  if (metric === "profit") return netProfitSeries(months);
  return months.map((m) => ({
    label: monthLabel(m.month),
    value: metric === "revenue" ? monthRevenue(m) : m.orders,
  }));
}

function isoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** First day of the month 11 months before `today`, through `today` (12 buckets). */
export function trailingRange(today: Date): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  return { from: isoDate(start), to: isoDate(today) };
}
```

Note: `pctChange(netProfit, prevNet)` uses `Math.abs(prev)`, so a loss→profit swing reads correctly.

- [ ] **Step 4: Run the test**

Run: `npx jest src/app/dashboard/_lib/kpiTiles.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/_lib/kpiTiles.ts src/app/dashboard/_lib/kpiTiles.test.ts
git commit -m "feat(overview): KPI tile + trend shaping helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Platform share + recent-order display helpers

**Files:**
- Create: `src/app/dashboard/_lib/platformShare.ts`, `src/app/dashboard/_lib/recentOrderDisplay.ts`
- Test: `src/app/dashboard/_lib/platformShare.test.ts`, `src/app/dashboard/_lib/recentOrderDisplay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // platformShare.ts
  export interface PlatformShare { platform: string; value: number; pct: number }
  export function platformShares(rows: { platform: string; value: number }[]): { total: number; shares: PlatformShare[] }
  // recentOrderDisplay.ts
  export const RECENT_ORDERS_LIMIT = 5
  export function platformLabel(platform: string): string
  export function buyerLabel(sale: { buyer_name: string | null; platform: string }): string
  export function initials(name: string): string
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/dashboard/_lib/platformShare.test.ts
import { platformShares } from "./platformShare";

describe("platformShares", () => {
  it("sorts by value and computes percentages that sum to 100", () => {
    const { total, shares } = platformShares([
      { platform: "amazon", value: 100 },
      { platform: "ebay", value: 200 },
      { platform: "etsy", value: 33 },
    ]);
    expect(total).toBe(333);
    expect(shares.map((s) => s.platform)).toEqual(["ebay", "amazon", "etsy"]);
    expect(shares.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100);
  });

  it("clamps refund-heavy negative platforms to zero and drops empty ones", () => {
    const { total, shares } = platformShares([
      { platform: "ebay", value: 50 },
      { platform: "amazon", value: -20 },
      { platform: "etsy", value: 0 },
    ]);
    expect(total).toBe(50);
    expect(shares).toEqual([{ platform: "ebay", value: 50, pct: 100 }]);
  });

  it("returns nothing when there is no revenue", () => {
    expect(platformShares([])).toEqual({ total: 0, shares: [] });
  });
});
```

```ts
// src/app/dashboard/_lib/recentOrderDisplay.test.ts
import { buyerLabel, initials, platformLabel } from "./recentOrderDisplay";

describe("initials", () => {
  it("uses first + last word initials", () => {
    expect(initials("Jane Doe")).toBe("JD");
    expect(initials("  maria de la cruz ")).toBe("MC");
  });
  it("uses the first two letters of a single word", () => {
    expect(initials("eBay")).toBe("EB");
  });
  it("falls back to ? for blank input", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("platformLabel", () => {
  it("uses brand casing for known platforms and capitalises unknown ones", () => {
    expect(platformLabel("ebay")).toBe("eBay");
    expect(platformLabel("kaufland")).toBe("Kaufland");
  });
});

describe("buyerLabel", () => {
  it("prefers the buyer name, else the platform label", () => {
    expect(buyerLabel({ buyer_name: " Jane Doe ", platform: "ebay" })).toBe("Jane Doe");
    expect(buyerLabel({ buyer_name: null, platform: "amazon" })).toBe("Amazon");
    expect(buyerLabel({ buyer_name: "", platform: "ebay" })).toBe("eBay");
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx jest src/app/dashboard/_lib/platformShare.test.ts src/app/dashboard/_lib/recentOrderDisplay.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/app/dashboard/_lib/platformShare.ts
/** Donut data for Home's "Revenue by Platform": positive shares, largest first. */
export interface PlatformShare {
  platform: string;
  value: number;
  /** Share of `total`, 0–100 (unrounded; round at display time). */
  pct: number;
}

export function platformShares(
  rows: { platform: string; value: number }[]
): { total: number; shares: PlatformShare[] } {
  // A refund-heavy platform can net negative; a donut can't draw that.
  const positive = rows.filter((r) => r.value > 0);
  const total = positive.reduce((a, r) => a + r.value, 0);
  if (total === 0) return { total: 0, shares: [] };
  const shares = positive
    .map((r) => ({ platform: r.platform, value: r.value, pct: (r.value / total) * 100 }))
    .sort((a, b) => b.value - a.value || a.platform.localeCompare(b.platform));
  return { total, shares };
}
```

```ts
// src/app/dashboard/_lib/recentOrderDisplay.ts
/** Display helpers for Home's Recent Orders card. */

/** Structural bound for the Recent Orders query — a fixed card size, not business growth. */
export const RECENT_ORDERS_LIMIT = 5;

const PLATFORM_LABELS: Record<string, string> = {
  ebay: "eBay",
  amazon: "Amazon",
  etsy: "Etsy",
  shopify: "Shopify",
  other: "Other",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** Buyer name when captured (eBay sync / manual entry), else the platform. */
export function buyerLabel(sale: { buyer_name: string | null; platform: string }): string {
  const name = sale.buyer_name?.trim();
  return name ? name : platformLabel(sale.platform);
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/app/dashboard/_lib/platformShare.test.ts src/app/dashboard/_lib/recentOrderDisplay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/_lib/platformShare.* src/app/dashboard/_lib/recentOrderDisplay.*
git commit -m "feat(overview): platform share + recent order display helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Extract the date picker and the data loader (no visible change)

This is a pure refactor. Home must look and behave exactly as before at the end of this task.

**Files:**
- Create: `src/app/dashboard/_components/useDateRangePicker.ts`
- Create: `src/app/dashboard/_components/DateRangePicker.tsx`
- Create: `src/app/dashboard/_components/useOverviewData.ts`
- Modify: `src/app/dashboard/page.tsx` (remove the inline picker state/markup, the `describeRange` helper, `RANGE_PRESETS`, `labelCls`/`inputCls` and the RPC `useEffect`; keep everything below the header)

**Interfaces:**
- Consumes: `trailingRange` (Task 1).
- Produces:
  ```ts
  // useDateRangePicker.ts
  export interface DateRangePickerState { /* fields below */ }
  export function useDateRangePicker(): DateRangePickerState
  export function describeRange(range: { from: string; to: string } | null): string
  // DateRangePicker.tsx
  export function DateRangePicker({ picker }: { picker: DateRangePickerState }): JSX.Element
  // useOverviewData.ts
  export interface OverviewData {
    sales: SalesOverview | null; expenses: ExpensesOverview | null; purchases: PurchasesOverview | null;
    payouts: PayoutsOverview | null; timeseries: OverviewTimeseries | null; trailing: OverviewTimeseries | null;
    isLoading: boolean;
  }
  export function useOverviewData(
    filter: { preset: DatePreset; dateFrom: string; dateTo: string },
    currency: Currency
  ): OverviewData
  ```

- [ ] **Step 1: Create `useDateRangePicker.ts`**

Move lines 38–58 (`RANGE_PRESETS`, `describeRange`) and the picker state/handlers from `DashboardPage` (the `preset`/`dateFrom`/`dateTo`/`periodMode`/`earliestYear` state, the earliest-year effect, `range`, `overviewDisplayValue`, `handleRangeSelect`, `yearOptions`, `currentPeriod`, `handlePeriodFieldChange`) verbatim. Keep their comments.

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { createTenantClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/date";
import {
  describePeriod, periodRange, resolveDateRange,
  type DatePreset, type PeriodUnit,
} from "@/lib/utils/filters";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";

export const RANGE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

export type RangeChoice = DatePreset | "specific_period";

export function describeRange(range: { from: string; to: string } | null): string {
  if (!range) return "all time";
  const from = range.from === "0000-00-00" ? null : range.from;
  const to = range.to === "9999-99-99" ? null : range.to;
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `until ${formatDate(to)}`;
  return "all time";
}

export interface DateRangePickerState {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  periodMode: "period" | "manual";
  range: { from: string; to: string } | null;
  displayValue: RangeChoice;
  onRangeSelect: (v: RangeChoice) => void;
  yearOptions: number[];
  currentPeriod: { year: number; unit: PeriodUnit };
  onPeriodFieldChange: (year: number, unit: PeriodUnit) => void;
}

/** Date-range picker state shared by Home and Analytics (one instance per page). */
export function useDateRangePicker(): DateRangePickerState {
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Local UI-only state, same role as FilterBar.tsx's `customSubMode` — see
  // that component's SKILL.md entry for the full "why": computed once at
  // mount, changed afterward only by this page's own explicit dropdown pick.
  const [periodMode, setPeriodMode] = useState<"period" | "manual">(() =>
    describePeriod(dateFrom, dateTo) ? "period" : "manual"
  );
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  // ── paste the earliest-year useEffect from page.tsx here, unchanged ──

  const range = useMemo(() => resolveDateRange(preset, dateFrom, dateTo), [preset, dateFrom, dateTo]);

  const displayValue: RangeChoice =
    preset === "custom" && periodMode === "period" ? "specific_period" : preset;

  function onRangeSelect(v: RangeChoice) {
    if (v === "specific_period") {
      setPeriodMode("period");
      const computed = periodRange(new Date().getFullYear(), "full");
      setPreset("custom");
      setDateFrom(computed.from);
      setDateTo(computed.to);
      return;
    }
    if (v === "custom") setPeriodMode("manual");
    setPreset(v);
  }

  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(earliestYear, currentYear);
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) yearOptions.push(y);

  const currentPeriod = describePeriod(dateFrom, dateTo) ?? { year: currentYear, unit: "full" as PeriodUnit };

  function onPeriodFieldChange(year: number, unit: PeriodUnit) {
    const computed = periodRange(year, unit);
    setDateFrom(computed.from);
    setDateTo(computed.to);
  }

  return {
    preset, dateFrom, dateTo, setDateFrom, setDateTo, periodMode, range,
    displayValue, onRangeSelect, yearOptions, currentPeriod, onPeriodFieldChange,
  };
}
```

The earliest-year effect is the one at page.tsx lines 80–119 (the three `fetchEarliestYear` calls in a `Promise.all`). Paste it in as-is, including `createTenantClient`.

- [ ] **Step 2: Create `DateRangePicker.tsx`**

Move the JSX currently passed as `PageHeader`'s `action` (the `<div className="flex items-end gap-3">…</div>` block, page.tsx ≈248–315) into this component. Rename references: `overviewDisplayValue` → `picker.displayValue`, `handleRangeSelect` → `picker.onRangeSelect`, `handlePeriodFieldChange` → `picker.onPeriodFieldChange`, `preset`/`periodMode`/`currentPeriod`/`yearOptions`/`dateFrom`/`dateTo`/`setDateFrom`/`setDateTo` → `picker.*`. Move `labelCls`/`inputCls` with it. Header:

```tsx
"use client";

import { PERIOD_UNIT_OPTIONS, type PeriodUnit } from "@/lib/utils/filters";
import { RANGE_PRESETS, type DateRangePickerState, type RangeChoice } from "./useDateRangePicker";

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
const inputCls =
  "rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer";

export function DateRangePicker({ picker }: { picker: DateRangePickerState }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* moved markup, with the renames above; the preset <select>'s onChange casts to RangeChoice */}
    </div>
  );
}
```

(`flex-wrap` is the one intentional change: it stops the From/To inputs overflowing at phone width.)

- [ ] **Step 3: Create `useOverviewData.ts`**

```ts
"use client";

import { useEffect, useState } from "react";
import { createTenantClient } from "@/lib/supabase/client";
import { resolveDateBounds, type DatePreset } from "@/lib/utils/filters";
import type { Currency } from "@/types";
import { trailingRange } from "../_lib/kpiTiles";
import type {
  ExpensesOverview, OverviewTimeseries, PayoutsOverview, PurchasesOverview, SalesOverview,
} from "../_lib/overviewTypes";

export interface OverviewData {
  sales: SalesOverview | null;
  expenses: ExpensesOverview | null;
  purchases: PurchasesOverview | null;
  payouts: PayoutsOverview | null;
  timeseries: OverviewTimeseries | null;
  /** Trailing 12 months, independent of the picked range — feeds sparklines + Home's trend chart. */
  trailing: OverviewTimeseries | null;
  isLoading: boolean;
}

/**
 * Range-scoped aggregates for Home and Analytics. Comes from 5 Postgres RPCs,
 * NOT from state.sales.items etc. Those Redux slices hold only ONE paginated
 * page (50 rows) and get replaced whenever the Sales/Expenses/Purchases pages
 * fetch a different page, so deriving date-ranged aggregates from them
 * silently produced wrong (often empty) results. The four 045 RPCs give the
 * headline totals; get_overview_timeseries (051) gives the monthly chart
 * series, the previous-period totals for the change badges, and the top vendor.
 */
export function useOverviewData(
  filter: { preset: DatePreset; dateFrom: string; dateTo: string },
  currency: Currency
): OverviewData {
  const { preset, dateFrom, dateTo } = filter;
  const [sales, setSales] = useState<SalesOverview | null>(null);
  const [expenses, setExpenses] = useState<ExpensesOverview | null>(null);
  const [purchases, setPurchases] = useState<PurchasesOverview | null>(null);
  const [payouts, setPayouts] = useState<PayoutsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<OverviewTimeseries | null>(null);
  const [trailing, setTrailing] = useState<OverviewTimeseries | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── paste page.tsx's load() effect here; rename setSalesOverview → setSales,
  //    setExpensesOverview → setExpenses, setPurchasesOverview → setPurchases,
  //    setPayoutsOverview → setPayouts, profileCurrency → currency ──

  // Trailing window: refetched only when the currency changes, not on every range pick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const { from, to } = trailingRange(new Date());
      const { data, error } = await supabase.rpc("get_overview_timeseries", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (cancelled) return;
      if (error) console.error("get_overview_timeseries (trailing) failed", error);
      setTrailing(error ? null : (data as OverviewTimeseries));
    })();
    return () => {
      cancelled = true;
    };
  }, [currency]);

  return { sales, expenses, purchases, payouts, timeseries, trailing, isLoading };
}
```

- [ ] **Step 4: Rewire `page.tsx`**

In `DashboardPage`, replace the removed code with:

```tsx
const picker = useDateRangePicker();
const { sales: salesOverview, expenses: expensesOverview, purchases: purchasesOverview,
        payouts: payoutsOverview, timeseries, isLoading } =
  useOverviewData({ preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo }, profileCurrency);
```

and in the JSX:

```tsx
<PageHeader
  title="Overview"
  description={`Summary for ${describeRange(picker.range)}`}
  action={<DateRangePicker picker={picker} />}
/>
```

Delete the imports that are now unused (`resolveDateRange`, `resolveDateBounds`, `periodRange`, `describePeriod`, `PERIOD_UNIT_OPTIONS`, `DatePreset`, `PeriodUnit`, `fetchEarliestYear`, `formatDate`, `createTenantClient`, the overview types, and `useEffect` if unused).

- [ ] **Step 5: Run the existing dashboard tests**

Run: `npx jest src/app/dashboard/_lib src/lib/utils/filters`
Expected: PASS (nothing behavioural changed).

- [ ] **Step 6: Commit** (the pre-commit hook type-checks the refactor)

```bash
git add src/app/dashboard/_components/useDateRangePicker.ts src/app/dashboard/_components/DateRangePicker.tsx src/app/dashboard/_components/useOverviewData.ts src/app/dashboard/page.tsx
git commit -m "refactor(overview): extract date picker + overview data hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `KpiTile` component

**Files:**
- Create: `src/app/dashboard/_components/KpiTile.tsx`

**Interfaces:**
- Consumes: `changeTone`, `formatPct` from `../_lib/overviewCharts`.
- Produces:
  ```ts
  export interface KpiTileProps {
    label: string;
    value: string;            // already formatted
    delta: number | null;
    goodWhen?: "up" | "down"; // omit → neutral tone (e.g. VAT)
    icon: React.ReactNode;    // lucide icon, size 18
    spark: number[];
    color: string;            // hex from useChartKit().colors
    loading?: boolean;        // first load: pulse skeleton
  }
  export function KpiTile(props: KpiTileProps): JSX.Element
  ```

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useId, type ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { changeTone, formatPct } from "../_lib/overviewCharts";

export interface KpiTileProps {
  label: string;
  value: string;
  delta: number | null;
  /** Direction that is good news; omit for a neutral-toned delta. */
  goodWhen?: "up" | "down";
  icon: ReactNode;
  spark: number[];
  /** Sparkline colour — hex from useChartKit().colors (SVG attrs can't read CSS vars). */
  color: string;
  loading?: boolean;
}

const TONE_CLASS = {
  good: "text-(--color-success)",
  bad: "text-(--color-danger)",
  neutral: "text-(--color-text-muted)",
} as const;

/** Apex-style stat tile: label + value + icon chip, delta line, edge-to-edge sparkline. */
export function KpiTile({ label, value, delta, goodWhen, icon, spark, color, loading = false }: KpiTileProps) {
  // useId() contains characters that break url(#…) references.
  const gradientId = `kpi-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tone = goodWhen ? changeTone(delta, goodWhen) : "neutral";
  const data = spark.map((v, i) => ({ i, v }));

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) overflow-hidden flex flex-col"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="p-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-(--color-text-muted)">{label}</p>
            {loading ? (
              <div className="mt-2 h-7 w-28 rounded-[var(--radius-btn)] bg-(--color-border-subtle) animate-pulse" />
            ) : (
              <p className="mt-1 text-2xl font-bold tabular-nums text-(--color-text-strong) truncate">{value}</p>
            )}
          </div>
          <span
            aria-hidden
            className="shrink-0 flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] bg-(--color-primary-muted) text-(--color-primary-text)"
          >
            {icon}
          </span>
        </div>
        <div className="mt-2 h-4 text-xs font-medium">
          {!loading && delta !== null && (
            <span className={`inline-flex items-center gap-1 tabular-nums ${TONE_CLASS[tone]}`}>
              {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {formatPct(delta)}
              <span className="ml-1 font-normal text-(--color-text-faint)">vs previous period</span>
            </span>
          )}
        </div>
      </div>
      <div className="h-14 mt-auto" aria-hidden>
        {!loading && data.length >= 2 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit** (types are checked by the hook; the tile is visually verified in Tasks 5–6)

```bash
git add src/app/dashboard/_components/KpiTile.tsx
git commit -m "feat(overview): Apex-style KpiTile with delta + sparkline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Analytics page + sidebar entry + card polish + Top Products table

**Files:**
- Create: `src/app/dashboard/analytics/page.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (import `BarChart3`; add a `NavItem` after Overview)
- Modify: `src/app/dashboard/_components/ChartCard.tsx` (heading style)
- Modify: `src/app/dashboard/_components/TopProductsCard.tsx` (table instead of a bar chart)

**Interfaces:**
- Consumes: `useDateRangePicker`, `describeRange`, `DateRangePicker`, `useOverviewData` (Task 3); `KpiTile` (Task 4); `buildKpis` (Task 1); `computePlatformBalance` from `../_lib/platformBalance`; all existing cards.

- [ ] **Step 1: Sidebar entry**

In `src/components/layout/Sidebar.tsx`, add `BarChart3` to the lucide import and insert after the Overview item:

```ts
  {
    label: "Analytics",
    href: "/dashboard/analytics",
    Icon: BarChart3,
    roles: ["super_admin", "admin", "accountant"],
  },
```

Overview is already matched exactly (`pathname === "/dashboard"`, Sidebar.tsx:191), so it won't also highlight on `/dashboard/analytics`.

- [ ] **Step 2: ChartCard heading**

In `ChartCard.tsx` change
`<h2 className="text-sm font-semibold text-(--color-text-base)">{title}</h2>`
to
`<h2 className="text-base font-semibold text-(--color-text-strong)">{title}</h2>`.

- [ ] **Step 3: Top Products as a ranked table**

Replace `TopProductsCard.tsx`'s body (drop the recharts imports and `truncate`):

```tsx
"use client";

import type { Currency } from "@/types";
import type { SalesOverview } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

export function TopProductsCard({ sales, currency }: { sales: SalesOverview | null; currency: Currency }) {
  const kit = useChartKit(currency);
  // get_sales_overview already groups, sorts and limits to the top 5.
  const products = sales?.topProducts ?? [];
  const top = products[0];
  const periodRevenue = sales?.revenue ?? 0;

  return (
    <ChartCard
      title="Top Products"
      headline={top ? kit.money(top.revenue) : kit.money(0)}
      meta={top ? `Best seller: ${top.name} · ${top.units} unit${top.units !== 1 ? "s" : ""}` : undefined}
      empty={products.length === 0}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-(--color-text-muted) border-b border-(--color-border-subtle)">
            <th className="py-2 pr-2 font-medium w-8">#</th>
            <th className="py-2 pr-2 font-medium">Product</th>
            <th className="py-2 pr-2 font-medium text-right">Units</th>
            <th className="py-2 font-medium text-right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const share = periodRevenue > 0 ? Math.min(100, (p.revenue / periodRevenue) * 100) : 0;
            return (
              <tr key={p.name} className="border-b border-(--color-border-subtle) last:border-0">
                <td className="py-2.5 pr-2 text-(--color-text-faint) tabular-nums">{i + 1}</td>
                <td className="py-2.5 pr-2 min-w-0">
                  <p className="truncate max-w-[16rem] text-(--color-text-strong)" title={p.name}>{p.name}</p>
                  <div className="mt-1 h-1 w-full max-w-[16rem] rounded-full bg-(--color-border-subtle)">
                    <div className="h-1 rounded-full bg-(--color-primary)" style={{ width: `${share}%` }} />
                  </div>
                </td>
                <td className="py-2.5 pr-2 text-right tabular-nums text-(--color-text-base)">{p.units.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums font-medium text-(--color-text-strong)">{kit.money(p.revenue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ChartCard>
  );
}
```

`ChartCard`'s chart slot is a fixed `h-[220px]`. Five rows at ~44px fit. Only if they overflow, add an optional `bodyClassName` prop to `ChartCard` (default `"mt-4 h-[220px]"`) and pass `"mt-4"` from here.

- [ ] **Step 4: Analytics page**

```tsx
// src/app/dashboard/analytics/page.tsx
"use client";

import { useMemo, useState } from "react";
import { DollarSign, Landmark, ShoppingBag, TrendingUp } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import type { Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { buildKpis } from "../_lib/kpiTiles";
import { computePlatformBalance } from "../_lib/platformBalance";
import { useDateRangePicker, describeRange } from "../_components/useDateRangePicker";
import { DateRangePicker } from "../_components/DateRangePicker";
import { useOverviewData } from "../_components/useOverviewData";
import { useChartKit } from "../_components/useChartKit";
import { KpiTile } from "../_components/KpiTile";
import { RevenueCard } from "../_components/RevenueCard";
import { NetProfitCard } from "../_components/NetProfitCard";
import { ExpensesCard } from "../_components/ExpensesCard";
import { PurchasesCard } from "../_components/PurchasesCard";
import { OrdersCard } from "../_components/OrdersCard";
import { VatCard } from "../_components/VatCard";
import { PlatformBalanceCard } from "../_components/PlatformBalanceCard";
import { TopProductsCard } from "../_components/TopProductsCard";
import { RecordTransferModal } from "../_components/RecordTransferModal";

export default function AnalyticsPage() {
  const currency: Currency = useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const canRecordTransfer = role === "admin" || role === "super_admin";
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);

  const picker = useDateRangePicker();
  const data = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    currency
  );
  const kit = useChartKit(currency);
  const kpis = buildKpis(data);
  const firstLoad = data.isLoading && data.sales === null;

  const vatCollected = data.sales?.vatCollected ?? 0;
  const vatPaid = (data.purchases?.vatPaid ?? 0) + (data.expenses?.vatPaid ?? 0);

  const ebayBalance = useMemo(
    () => computePlatformBalance("ebay", data.sales, data.expenses, data.payouts),
    [data.sales, data.expenses, data.payouts]
  );
  const amazonBalance = useMemo(
    () => computePlatformBalance("amazon", data.sales, data.expenses, data.payouts),
    [data.sales, data.expenses, data.payouts]
  );

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={`Detailed performance for ${describeRange(picker.range)}`}
        action={<DateRangePicker picker={picker} />}
      />

      <div className={data.isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <KpiTile label="Revenue" value={kit.money(kpis.revenue.value)} delta={kpis.revenue.delta}
            goodWhen="up" icon={<DollarSign size={18} />} spark={kpis.revenue.spark}
            color={kit.colors.positive} loading={firstLoad} />
          <KpiTile label="Net Profit" value={kit.money(kpis.netProfit.value)} delta={kpis.netProfit.delta}
            goodWhen="up" icon={<TrendingUp size={18} />} spark={kpis.netProfit.spark}
            color={kpis.netProfit.value >= 0 ? kit.colors.positive : kit.colors.negative} loading={firstLoad} />
          <KpiTile label="Purchases" value={kit.money(kpis.purchases.value)} delta={kpis.purchases.delta}
            goodWhen="down" icon={<ShoppingBag size={18} />} spark={kpis.purchases.spark}
            color={kit.colors.neutral} loading={firstLoad} />
          <KpiTile label={kpis.vatPosition.value >= 0 ? "VAT payable" : "VAT refundable"}
            value={kit.money(Math.abs(kpis.vatPosition.value))} delta={null}
            icon={<Landmark size={18} />} spark={kpis.vatPosition.spark}
            color={kit.colors.pending} loading={firstLoad} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RevenueCard sales={data.sales} timeseries={data.timeseries} currency={currency} />
          <NetProfitCard netProfit={kpis.netProfit.value} revenue={kpis.revenue.value}
            timeseries={data.timeseries} currency={currency} />
          <ExpensesCard expenses={data.expenses} timeseries={data.timeseries} currency={currency} />
          <PurchasesCard purchases={data.purchases} timeseries={data.timeseries} currency={currency} />
          <OrdersCard sales={data.sales} timeseries={data.timeseries} currency={currency} />
          <VatCard vatCollected={vatCollected} vatPaid={vatPaid} timeseries={data.timeseries} currency={currency} />
          {/* Balance cards are hidden when the platform had no sales in the period */}
          {ebayBalance !== null && (
            <PlatformBalanceCard platform="ebay" balance={ebayBalance} currency={currency}
              onRecordTransfer={canRecordTransfer ? () => setTransferModal("ebay") : undefined} />
          )}
          {amazonBalance !== null && (
            <PlatformBalanceCard platform="amazon" balance={amazonBalance} currency={currency}
              onRecordTransfer={canRecordTransfer ? () => setTransferModal("amazon") : undefined} />
          )}
          <TopProductsCard sales={data.sales} currency={currency} />
        </div>
      </div>

      {transferModal !== null && (
        <RecordTransferModal
          platform={transferModal}
          currency={currency}
          pendingBalance={transferModal === "ebay" ? (ebayBalance?.pending ?? 0) : (amazonBalance?.pending ?? 0)}
          onClose={() => setTransferModal(null)}
          onSaved={() => setTransferModal(null)}
        />
      )}
    </div>
  );
}
```

`buildKpis(data)` is valid because `OverviewData` is a superset of `KpiInput`. If TypeScript complains about the extra fields, pass `{ sales: data.sales, expenses: data.expenses, purchases: data.purchases, timeseries: data.timeseries, trailing: data.trailing }`.

- [ ] **Step 5: Run the tests**

Run: `npx jest src/app/dashboard/_lib`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx src/components/layout/Sidebar.tsx src/app/dashboard/_components/ChartCard.tsx src/app/dashboard/_components/TopProductsCard.tsx
git commit -m "feat(analytics): new Analytics page with KPI tiles and detail cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Slim Home (trend chart, platform donut, recent orders)

**Files:**
- Create: `src/app/dashboard/_components/OverviewTrendCard.tsx`
- Create: `src/app/dashboard/_components/PlatformDonutCard.tsx`
- Create: `src/app/dashboard/_components/RecentOrdersCard.tsx`
- Modify: `src/app/dashboard/page.tsx` (replace the card grid; remove the transfer modal/balance code, which moved to Analytics)

**Interfaces:**
- Consumes: `trendSeries`, `TrendMetric`, `buildKpis` (Task 1); `platformShares` (Task 2); `RECENT_ORDERS_LIMIT`, `buyerLabel`, `initials`, `platformLabel` (Task 2); `avatarClassesFor` from `@/app/dashboard/messages/_lib/avatarColor`; `KpiTile`; `useChartKit`; `seriesColor` from `../_lib/chartPalette`; `StatusBadge`, `PlatformBadge` from `@/components/ui/Badge`.

- [ ] **Step 1: `OverviewTrendCard.tsx`**

```tsx
"use client";

import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import { trendSeries, type TrendMetric } from "../_lib/kpiTiles";
import type { OverviewTimeseries } from "../_lib/overviewTypes";
import { useChartKit } from "./useChartKit";

const METRICS: { value: TrendMetric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "orders", label: "Orders" },
  { value: "profit", label: "Profit" },
];

/** Home's single chart: last 12 months, switchable metric (Apex "Overview" card). */
export function OverviewTrendCard({ trailing, currency }: { trailing: OverviewTimeseries | null; currency: Currency }) {
  const kit = useChartKit(currency);
  const [metric, setMetric] = useState<TrendMetric>("revenue");
  const gradientId = `trend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const data = trendSeries(trailing?.months ?? [], metric);
  const hasData = data.some((p) => p.value !== 0);
  const color = metric === "orders" ? kit.colors.neutral : kit.colors.positive;
  const fmt = metric === "orders" ? (v: number) => v.toLocaleString() : kit.compact;
  const tooltipFmt = metric === "orders" ? (v: number) => v.toLocaleString() : kit.money;

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 flex flex-col xl:col-span-2"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--color-text-strong)">Overview</h2>
          <p className="text-sm text-(--color-text-muted)">Last 12 months</p>
        </div>
        <div role="group" aria-label="Chart metric"
          className="inline-flex rounded-[var(--radius-btn)] bg-(--color-surface-subtle) border border-(--color-border-subtle) p-1">
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={metric === m.value}
              onClick={() => setMetric(m.value)}
              className={`px-3 py-1.5 text-sm rounded-[var(--radius-btn)] transition-colors cursor-pointer ${
                metric === m.value
                  ? "bg-(--color-surface) text-(--color-text-strong) font-medium border border-(--color-border)"
                  : "text-(--color-text-muted) hover:text-(--color-text-strong) border border-transparent"
              }`}
              style={metric === m.value ? { boxShadow: "var(--shadow-card)" } : undefined}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 h-[300px]">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke={kit.colors.grid} vertical={false} />
              <XAxis dataKey="label" {...kit.axis} />
              <YAxis {...kit.axis} tickFormatter={fmt} width={56} />
              <Tooltip {...kit.tooltip} formatter={(v) => [tooltipFmt(Number(v ?? 0)), METRICS.find((m) => m.value === metric)?.label]} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5}
                fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: color }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-(--color-text-faint)">
            No data in this period
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: `PlatformDonutCard.tsx`**

```tsx
"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Currency } from "@/types";
import { seriesColor } from "../_lib/chartPalette";
import { platformShares } from "../_lib/platformShare";
import type { SalesOverview } from "../_lib/overviewTypes";
import { platformLabel } from "../_lib/recentOrderDisplay";
import { useChartKit } from "./useChartKit";

export function PlatformDonutCard({
  sales, rangeLabel, currency,
}: { sales: SalesOverview | null; rangeLabel: string; currency: Currency }) {
  const kit = useChartKit(currency);
  const { total, shares } = platformShares(sales?.revenueByPlatform ?? []);

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 flex flex-col"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="text-base font-semibold text-(--color-text-strong)">Revenue by Platform</h2>
      <p className="text-sm text-(--color-text-muted)">{rangeLabel}</p>
      {shares.length === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-(--color-text-faint)">
          No sales in this period
        </div>
      ) : (
        <>
          <div className="relative mt-4 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shares} dataKey="value" nameKey="platform" innerRadius="70%" outerRadius="100%"
                  paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {shares.map((s, i) => <Cell key={s.platform} fill={seriesColor(s.platform, i)} />)}
                </Pie>
                <Tooltip {...kit.tooltip}
                  formatter={(v, name) => [kit.money(Number(v ?? 0)), platformLabel(String(name))]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-(--color-text-strong)">{kit.compact(total)}</span>
              <span className="text-xs text-(--color-text-muted)">Revenue</span>
            </div>
          </div>
          <ul className="mt-5 space-y-2.5">
            {shares.map((s, i) => (
              <li key={s.platform} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: seriesColor(s.platform, i) }} />
                <span className="text-(--color-text-base)">{platformLabel(s.platform)}</span>
                <span className="ml-auto font-semibold tabular-nums text-(--color-text-strong)">{s.pct.toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: `RecentOrdersCard.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createTenantClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { PlatformBadge, StatusBadge } from "@/components/ui/Badge";
import type { Sale } from "@/types";
import { avatarClassesFor } from "@/app/dashboard/messages/_lib/avatarColor";
import { RECENT_ORDERS_LIMIT, buyerLabel, initials } from "../_lib/recentOrderDisplay";

type RecentOrder = Pick<Sale, "id" | "platform" | "product_name" | "total_amount" | "currency" | "date" | "status" | "buyer_name">;

/**
 * Latest orders regardless of the picked range. Own query — the Redux
 * `sales` slice holds whichever page the Orders page last fetched.
 */
export function RecentOrdersCard() {
  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const { data, error } = await supabase
        .from("sales")
        .select("id, platform, product_name, total_amount, currency, date, status, buyer_name")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(RECENT_ORDERS_LIMIT);
      if (cancelled) return;
      if (error) {
        console.error("recent orders failed", error);
        setFailed(true);
        setOrders([]);
        return;
      }
      setOrders((data ?? []) as RecentOrder[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-(--color-text-strong)">Recent Orders</h2>
          <p className="text-sm text-(--color-text-muted)">Latest {RECENT_ORDERS_LIMIT} orders</p>
        </div>
        <Link href="/dashboard/sales"
          className="inline-flex items-center gap-1 text-sm font-medium text-(--color-primary-text) hover:underline">
          View all <ArrowUpRight size={16} />
        </Link>
      </div>

      {orders === null ? (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: RECENT_ORDERS_LIMIT }, (_, i) => (
            <div key={i} className="h-12 rounded-[var(--radius-btn)] bg-(--color-border-subtle) animate-pulse" />
          ))}
        </div>
      ) : failed ? (
        <p className="text-sm text-(--color-danger-text)">Couldn&apos;t load recent orders.</p>
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--color-text-faint)">No orders yet</p>
      ) : (
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-(--color-text-muted) border-b border-(--color-border)">
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Platform</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const name = buyerLabel(o);
                return (
                  <tr key={o.id} className="border-b border-(--color-border-subtle) last:border-0 hover:bg-(--color-surface-subtle)">
                    <td className="py-3 pr-3">
                      <Link href={`/dashboard/sales/${o.id}`} className="flex items-center gap-3 min-w-0">
                        <span aria-hidden className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${avatarClassesFor(name)}`}>
                          {initials(name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-(--color-text-strong)">{name}</span>
                          <span className="block truncate text-xs text-(--color-text-muted)">{o.product_name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 pr-3"><PlatformBadge platform={o.platform} /></td>
                    <td className="py-3 pr-3"><StatusBadge status={o.status} /></td>
                    <td className="py-3 pr-3 text-(--color-text-base) whitespace-nowrap">{formatDate(o.date)}</td>
                    <td className="py-3 text-right font-semibold tabular-nums text-(--color-text-strong) whitespace-nowrap">
                      {formatCurrency(o.total_amount, o.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Rebuild `page.tsx`**

Replace the card grid and transfer modal. The Quick Start box stays. Final body:

```tsx
export default function DashboardPage() {
  const profileCurrency: Currency =
    useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const picker = useDateRangePicker();
  const data = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    profileCurrency
  );
  const kit = useChartKit(profileCurrency);
  const kpis = buildKpis(data);
  const firstLoad = data.isLoading && data.sales === null;
  const rangeLabel = describeRange(picker.range);

  return (
    <div>
      <PageHeader title="Overview" description={`Summary for ${rangeLabel}`}
        action={<DateRangePicker picker={picker} />} />

      <div className={`space-y-4 ${data.isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiTile label="Revenue" value={kit.money(kpis.revenue.value)} delta={kpis.revenue.delta}
            goodWhen="up" icon={<DollarSign size={18} />} spark={kpis.revenue.spark}
            color={kit.colors.positive} loading={firstLoad} />
          <KpiTile label="Net Profit" value={kit.money(kpis.netProfit.value)} delta={kpis.netProfit.delta}
            goodWhen="up" icon={<TrendingUp size={18} />} spark={kpis.netProfit.spark}
            color={kpis.netProfit.value >= 0 ? kit.colors.positive : kit.colors.negative} loading={firstLoad} />
          <KpiTile label="Orders" value={kpis.orders.value.toLocaleString()} delta={kpis.orders.delta}
            goodWhen="up" icon={<ShoppingCart size={18} />} spark={kpis.orders.spark}
            color={kit.colors.neutral} loading={firstLoad} />
          <KpiTile label="Expenses" value={kit.money(kpis.expenses.value)} delta={kpis.expenses.delta}
            goodWhen="down" icon={<Receipt size={18} />} spark={kpis.expenses.spark}
            color={kit.colors.negative} loading={firstLoad} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <OverviewTrendCard trailing={data.trailing} currency={profileCurrency} />
          <PlatformDonutCard sales={data.sales} rangeLabel={rangeLabel} currency={profileCurrency} />
        </div>
      </div>

      <div className="mt-4">
        <RecentOrdersCard />
      </div>

      <div className="mt-4 bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <h2 className="text-base font-semibold text-(--color-text-strong) mb-1">Quick Start</h2>
        <p className="text-sm text-(--color-text-muted)">
          Use the sidebar to navigate to Orders, Expenses, and Purchases, or open Analytics for
          detailed charts. Figures above reflect the selected date range and use {profileCurrency} as
          the base currency. Change badges compare with the period of the same length just before
          it; sparklines and the Overview chart always show the last 12 months.
        </p>
      </div>
    </div>
  );
}
```

Imports: `DollarSign, Receipt, ShoppingCart, TrendingUp` from lucide-react; `buildKpis`; `useChartKit`; `KpiTile`; `OverviewTrendCard`; `PlatformDonutCard`; `RecentOrdersCard`; the picker/data hooks. Remove the imports of the detail cards, `RecordTransferModal`, `computePlatformBalance`, `calculateNetProfit`, `useMemo`/`useState` and `currentUserRole`, all now used only on Analytics.

`RecentOrdersCard` sits outside the loading-overlay div on purpose: it doesn't depend on the range.

- [ ] **Step 5: Run the tests**

Run: `npx jest src/app/dashboard/_lib src/app/dashboard/messages/_lib`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/_components/OverviewTrendCard.tsx src/app/dashboard/_components/PlatformDonutCard.tsx src/app/dashboard/_components/RecentOrdersCard.tsx
git commit -m "feat(overview): Apex-style Home — KPI tiles, trend chart, platform donut, recent orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, visual verification, PR

**Files:**
- Modify: `src/app/dashboard/CLAUDE.md`, `src/app/dashboard/SKILL.md`, `AGENTS.md` (feature table)
- Create: `src/app/dashboard/analytics/CLAUDE.md`, `src/app/dashboard/analytics/SKILL.md`
- Modify: `src/app/dashboard/messages/CLAUDE.md` (note that `_lib/avatarColor.ts` now has a second consumer, `dashboard/_components/RecentOrdersCard.tsx`, and should be promoted to `src/components/ui/` if a third feature needs it)

- [ ] **Step 1: Update `dashboard/CLAUDE.md`**

Rewrite the `page.tsx` entry to cover:
- Home = 4 `KpiTile`s + `OverviewTrendCard` + `PlatformDonutCard` + `RecentOrdersCard` + Quick Start.
- Data comes from `useOverviewData`: the same 5 RPCs, plus a trailing-12-month `get_overview_timeseries` that reruns only on currency change.
- Recent Orders runs its own `.limit(RECENT_ORDERS_LIMIT)` query.
- The detail cards now live on `/dashboard/analytics`.

Add file-map entries for `KpiTile`, `OverviewTrendCard`, `PlatformDonutCard`, `RecentOrdersCard`, `DateRangePicker`, `useDateRangePicker`, `useOverviewData`, `_lib/kpiTiles`, `_lib/platformShare` and `_lib/recentOrderDisplay`. Add Analytics to the feature table.

- [ ] **Step 2: Update `dashboard/SKILL.md`**

Add these entries:
- **"Add a KPI tile":** add the field to `KpiSet` in `_lib/kpiTiles.ts` plus a test, then render a `KpiTile` on the page. The colour comes from `useChartKit().colors`.
- **"Move a card between Home and Analytics":** both pages read the same `useOverviewData` result.
- **Gotcha:** sparklines and Home's trend chart use the trailing 12-month window, never the picked range. A one-month range would give a single-point sparkline.
- **Gotcha:** `useId()` output must be sanitised before it's used in `url(#…)` gradient references.
- **Gotcha:** `RecentOrdersCard` deliberately bypasses the Redux `sales` slice.

- [ ] **Step 3: Create `analytics/CLAUDE.md` and `analytics/SKILL.md`**

`CLAUDE.md`: the file map (`page.tsx` only), and a note that all its components and data come from `../_components` and `../_lib` (the Overview family). It also records that the Record Transfer admin gate lives here now, and the test command `npx jest src/app/dashboard/_lib`.

`SKILL.md`: the minimal file set for adding a detail card (a card component in `dashboard/_components/` plus a grid slot in `analytics/page.tsx`), and a gotcha that the picker state isn't shared with Home by design.

- [ ] **Step 4: Add the Analytics row to `AGENTS.md`'s feature-folder table**

```
| `src/app/dashboard/analytics/` | `/dashboard/analytics` | detailed chart cards + KPI tiles (components shared with Overview in `dashboard/_components/`) |
```

- [ ] **Step 5: Visual verification**

If the Playwright MCP is connected and `npm run dev` is already running, screenshot `/dashboard` and `/dashboard/analytics`:
- in the light and dark themes (toggle via the header theme button);
- at 1440px and at 390px width;
- with the picker on "This Month" and on "All Time" (deltas should hide).

Check that sparklines render, the donut legend percentages add up, Recent Orders links open the order page, and the sidebar highlights only one item on each page.

If Playwright isn't available, ask the user to check the same list and report back.

- [ ] **Step 6: Run the focused tests one last time**

Run: `npx jest src/app/dashboard`
Expected: PASS (integration tests are excluded by config).

- [ ] **Step 7: Commit the docs, push and open the PR**

```bash
git add AGENTS.md src/app/dashboard/CLAUDE.md src/app/dashboard/SKILL.md src/app/dashboard/analytics/CLAUDE.md src/app/dashboard/analytics/SKILL.md src/app/dashboard/messages/CLAUDE.md
git commit -m "docs: Home + Analytics file maps and playbooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/apex-home-analytics
gh pr create --title "Apex-style Home + new Analytics page" --body "$(cat <<'EOF'
## Summary
- Home: 4 KPI tiles (value, % vs previous period, 12-month sparkline), Overview trend chart (Revenue/Orders/Profit), revenue-by-platform donut, Recent Orders.
- New /dashboard/analytics with the detailed chart cards (moved from Home), KPI tiles, and Top Products as a ranked table.
- Theme unchanged; no new RPCs or migrations (one extra get_overview_timeseries call for the trailing 12 months).

Spec: docs/superpowers/specs/2026-09-27-apex-home-analytics-design.md

## Test plan
- [ ] npx jest src/app/dashboard
- [ ] Home + Analytics in light/dark, desktop/mobile
- [ ] "All Time" hides deltas; Recent Orders rows open the order page

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
