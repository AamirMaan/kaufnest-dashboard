import { buildPlatformStats } from "./platformStats";
import type { ExpensesOverview, PayoutsOverview, SalesOverview } from "./overviewTypes";

function sales(partial: Partial<SalesOverview>): SalesOverview {
  return {
    orderCount: 0, effectiveOrderCount: 0, unitsSold: 0, revenue: 0, fees: 0, vatCollected: 0,
    revenueByPlatform: [], topProducts: [], monthlyRevenue: [], platformBalance: [],
    ...partial,
  };
}

const expenses: ExpensesOverview = {
  total: 0, vatPaid: 0, byCategory: [], monthlyExpenses: [],
  platformSubtotal: [{ platform: "ebay", amount: 10 }],
};
const payouts: PayoutsOverview = { transferred: [{ platform: "ebay", amount: 50 }] };

describe("buildPlatformStats", () => {
  it("returns an empty list with no sales data", () => {
    expect(buildPlatformStats(null, null, null)).toEqual([]);
  });

  it("sorts by revenue, computes share and attaches eBay/Amazon balances only", () => {
    const s = sales({
      revenueByPlatform: [
        { platform: "etsy", value: 100 },
        { platform: "ebay", value: 300 },
      ],
      platformBalance: [{ platform: "ebay", sales: 300, adFees: 20, shippingFees: 30, platformFees: 10, count: 4 }],
    });
    const stats = buildPlatformStats(s, expenses, payouts);
    expect(stats.map((p) => p.platform)).toEqual(["ebay", "etsy"]);
    expect(stats[0].sharePct).toBeCloseTo(75);
    expect(stats[1].sharePct).toBeCloseTo(25);
    expect(stats[0].balance).toMatchObject({ balance: 230, transferred: 50, pending: 180, count: 4 });
    expect(stats[1].balance).toBeNull();
  });

  it("gives a negative-revenue platform a 0% share without skewing the others", () => {
    const s = sales({
      revenueByPlatform: [
        { platform: "amazon", value: -20 },
        { platform: "shopify", value: 80 },
      ],
    });
    const stats = buildPlatformStats(s, null, null);
    expect(stats[0]).toMatchObject({ platform: "shopify", sharePct: 100 });
    expect(stats[1]).toMatchObject({ platform: "amazon", sharePct: 0, balance: null });
  });
});
