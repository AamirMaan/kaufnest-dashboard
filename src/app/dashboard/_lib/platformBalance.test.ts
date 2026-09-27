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
    platformBalance: [{ platform: "ebay", sales: 1000, adFees: 50, shippingFees: 30, count: 12 }],
  } as SalesOverview;
  const expenses = {
    platformSubtotal: [
      { platform: "ebay", amount: 20 },
      { platform: "amazon", amount: 5 },
    ],
  } as ExpensesOverview;
  const payouts: PayoutsOverview = { transferred: [{ platform: "ebay", amount: 600 }] };

  it("combines sales, fees, platform expenses and payouts", () => {
    expect(computePlatformBalance("ebay", sales, expenses, payouts)).toEqual({
      balance: 900, sales: 1000, adFees: 50, shippingFees: 30, expenses: 20,
      transferred: 600, pending: 300, count: 12,
    });
  });

  it("is null when the platform had no sales", () => {
    expect(computePlatformBalance("amazon", sales, expenses, payouts)).toBeNull();
    expect(computePlatformBalance("ebay", null, expenses, payouts)).toBeNull();
  });

  it("treats missing expense and payout rows as zero", () => {
    expect(computePlatformBalance("ebay", sales, null, null)).toEqual(
      expect.objectContaining({ balance: 920, transferred: 0, pending: 920 })
    );
  });
});
