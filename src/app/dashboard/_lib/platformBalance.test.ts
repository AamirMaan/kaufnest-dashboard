import { computePending, computePlatformBalance } from "./platformBalance";
import type { ExpensesOverview, PayoutsOverview, SalesOverview } from "./overviewTypes";

describe("computePending", () => {
  it("subtracts the pre-summed transferred amount from balance", () => {
    expect(computePending(500, 200)).toBe(300);
  });

  it("returns a negative pending when more was transferred than earned", () => {
    expect(computePending(100, 150)).toBe(-50);
  });
});

describe("computePlatformBalance", () => {
  const sales = {
    platformBalance: [{ platform: "ebay", sales: 1000, adFees: 50, shippingFees: 30, platformFees: 25, count: 12 }],
  } as SalesOverview;
  const expenses = {
    platformSubtotal: [
      { platform: "ebay", amount: 20 },
      { platform: "amazon", amount: 5 },
    ],
  } as ExpensesOverview;
  const payouts: PayoutsOverview = { transferred: [{ platform: "ebay", amount: 600 }] };

  it("combines sales, ad/shipping/platform fees, platform expenses and payouts", () => {
    // 1000 − 50 ad − 30 shipping − 25 per-order platform fees − 20 expenses
    expect(computePlatformBalance("ebay", sales, expenses, payouts)).toEqual({
      balance: 875, sales: 1000, adFees: 50, shippingFees: 30, platformFees: 25, expenses: 20,
      transferred: 600, pending: 275, count: 12,
    });
  });

  it("treats a missing platformFees (RPC not yet on migration 053) as zero", () => {
    const pre053 = {
      platformBalance: [{ platform: "ebay", sales: 1000, adFees: 50, shippingFees: 30, count: 12 }],
    } as unknown as SalesOverview;
    expect(computePlatformBalance("ebay", pre053, null, null)).toEqual(
      expect.objectContaining({ platformFees: 0, balance: 920 })
    );
  });

  it("is null when the platform had no sales", () => {
    expect(computePlatformBalance("amazon", sales, expenses, payouts)).toBeNull();
    expect(computePlatformBalance("ebay", null, expenses, payouts)).toBeNull();
  });

  it("treats missing expense and payout rows as zero", () => {
    expect(computePlatformBalance("ebay", sales, null, null)).toEqual(
      expect.objectContaining({ balance: 895, transferred: 0, pending: 895 })
    );
  });
});
