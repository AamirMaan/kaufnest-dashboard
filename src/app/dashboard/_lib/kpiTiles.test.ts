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
  previous: { revenue: 800, expenses: 250, purchases: 300, orders: 10, effective_orders: 8, fees: 50 },
  top_vendor: null,
};

const trailing: OverviewTimeseries = {
  months: [
    month({ month: "2026-08", revenue_by_platform: { ebay: 100, amazon: 50 }, orders: 3, returned_cancelled: 1, fees: 10, expenses: 20, purchases: 30, vat_collected: 9, vat_paid: 4 }),
    month({ month: "2026-09", revenue_by_platform: { ebay: 200 }, orders: 5, fees: 20, expenses: 40, purchases: 0, vat_collected: 12, vat_paid: 2 }),
  ],
  previous: null,
  top_vendor: null,
};

describe("buildKpis", () => {
  const k = buildKpis({ sales, expenses, purchases, timeseries, trailing });

  it("takes headline values from the range overviews", () => {
    expect(k.revenue.value).toBe(1000);
    // Orders counts revenue-eligible orders only, like Revenue and the platform cards.
    expect(k.orders.value).toBe(10);
    expect(k.expenses.value).toBe(200);
    expect(k.purchases.value).toBe(300);
    expect(k.netProfit.value).toBe(1000 - 100 - 200 - 300); // 400
    expect(k.vatPosition.value).toBe(190 - (30 + 50)); // 110
  });

  it("computes deltas against timeseries.previous", () => {
    expect(k.revenue.delta).toBeCloseTo(25); // 1000 vs 800
    expect(k.orders.delta).toBeCloseTo(25); // 10 vs 8 effective
    expect(k.expenses.delta).toBeCloseTo(-20); // 200 vs 250
    expect(k.purchases.delta).toBeCloseTo(0);
    // previous net = 800 - 50 - 250 - 300 = 200 → 400 vs 200 = +100%
    expect(k.netProfit.delta).toBeCloseTo(100);
    expect(k.vatPosition.delta).toBeNull(); // no previous VAT figure exists
  });

  it("builds spark series from the trailing months", () => {
    expect(k.revenue.spark).toEqual([150, 200]);
    expect(k.orders.spark).toEqual([2, 5]); // orders − returned/cancelled
    expect(k.expenses.spark).toEqual([20, 40]);
    expect(k.purchases.spark).toEqual([30, 0]);
    expect(k.netProfit.spark).toEqual([150 - 10 - 20 - 30, 200 - 20 - 40 - 0]);
    expect(k.vatPosition.spark).toEqual([5, 10]);
  });

  it("hides the orders delta when previous lacks effective_orders (RPC before 054)", () => {
    const { effective_orders: _omit, ...pre054 } = timeseries.previous!;
    const k2 = buildKpis({ sales, expenses, purchases, timeseries: { ...timeseries, previous: pre054 }, trailing });
    expect(k2.orders.delta).toBeNull();
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
