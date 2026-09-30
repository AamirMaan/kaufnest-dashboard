/**
 * Pure shaping helpers for the Overview chart cards. Inputs are the RPC
 * results typed in ./overviewTypes; outputs are plain arrays recharts can
 * render. No React/Supabase here — see overviewCharts.test.ts.
 */
import type { OverviewMonth, PlatformBalance } from "./overviewTypes";

export type ChangeTone = "good" | "bad" | "neutral";

/** Relative change in percent, or null when there's no previous value to compare. */
export function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Whether a change is good news. Expenses/purchases going up is bad. */
export function changeTone(pct: number | null, goodWhen: "up" | "down"): ChangeTone {
  if (pct === null || pct === 0) return "neutral";
  return (pct > 0) === (goodWhen === "up") ? "good" : "bad";
}

/** `+12.3%` / `−4.0%` (true minus sign) / `0.0%`. */
export function formatPct(pct: number): string {
  const abs = Math.abs(pct).toFixed(1);
  if (Number(abs) === 0) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${abs}%`;
}

/** Profit as a percent of revenue, or null when revenue isn't positive. */
export function margin(profit: number, revenue: number): number | null {
  if (revenue <= 0) return null;
  return (profit / revenue) * 100;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-01` → `Jan 26`. Fixed English names so labels don't depend on the browser locale. */
export function monthLabel(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  const name = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined;
  if (!match || !name) return ym;
  return `${name} ${match[1].slice(2)}`;
}

export type NumericMonthField = Exclude<
  keyof OverviewMonth,
  "month" | "revenue_by_platform" | "expenses_by_category"
>;

export function sumMonths(months: OverviewMonth[], field: NumericMonthField): number {
  return months.reduce((total, m) => total + m[field], 0);
}

function revenueOf(m: OverviewMonth): number {
  return Object.values(m.revenue_by_platform).reduce((a, b) => a + b, 0);
}

export interface StackedSeries {
  /** Series keys, largest period total first (ties by name). */
  keys: string[];
  rows: { label: string; values: Record<string, number> }[];
}

/** One row per month with every key present (0-filled), for stacked bars. */
export function stackedSeries(
  months: OverviewMonth[],
  key: "revenue_by_platform" | "expenses_by_category"
): StackedSeries {
  const totals = new Map<string, number>();
  for (const m of months) {
    for (const [k, v] of Object.entries(m[key])) totals.set(k, (totals.get(k) ?? 0) + v);
  }
  const keys = [...totals.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([k]) => k);
  const rows = months.map((m) => ({
    label: monthLabel(m.month),
    values: Object.fromEntries(keys.map((k) => [k, m[key][k] ?? 0])),
  }));
  return { keys, rows };
}

export interface LabeledValue {
  label: string;
  value: number;
}

/** Monthly revenue − sale fees − expenses − purchases (same formula as the headline). */
export function netProfitSeries(months: OverviewMonth[]): LabeledValue[] {
  return months.map((m) => ({
    label: monthLabel(m.month),
    value: revenueOf(m) - m.fees - m.expenses - m.purchases,
  }));
}

/** Highest and lowest points; null with fewer than two. The first point wins ties. */
export function bestWorstMonth(
  series: LabeledValue[]
): { best: LabeledValue; worst: LabeledValue } | null {
  if (series.length < 2) return null;
  let best = series[0];
  let worst = series[0];
  for (const point of series) {
    if (point.value > best.value) best = point;
    if (point.value < worst.value) worst = point;
  }
  return { best, worst };
}

/** Largest category and its percent share of the total; null when empty or total ≤ 0. */
export function topCategoryShare(
  byCategory: { category: string; amount: number }[],
  total: number
): { category: string; amount: number; share: number } | null {
  if (byCategory.length === 0 || total <= 0) return null;
  const top = byCategory.reduce((a, b) => (b.amount > a.amount ? b : a));
  return { category: top.category, amount: top.amount, share: (top.amount / total) * 100 };
}

/** Returned/cancelled orders as a percent of all orders; null without orders. */
export function returnRate(orders: number, returnedCancelled: number): number | null {
  if (orders <= 0) return null;
  return (returnedCancelled / orders) * 100;
}

export type BalanceTone = "positive" | "negative" | "neutral" | "pending";

export function balanceBars(b: PlatformBalance): { name: string; value: number; tone: BalanceTone }[] {
  return [
    { name: "Sales", value: b.sales, tone: "positive" },
    { name: "Fees", value: b.adFees + b.shippingFees + b.platformFees, tone: "negative" },
    { name: "Expenses", value: b.expenses, tone: "negative" },
    { name: "Transferred", value: b.transferred, tone: "neutral" },
    { name: "Pending", value: b.pending, tone: "pending" },
  ];
}
