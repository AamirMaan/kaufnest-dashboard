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
