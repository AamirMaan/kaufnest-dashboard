import { computePending, computePlatformBalance, runningBalanceAsOf } from "./platformBalance";
import type { ExpensesOverview, PayoutsOverview, RunningPlatformBalance, SalesOverview } from "./overviewTypes";

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
      transferred: 600, pending: 275, pendingIsRunning: false, count: 12,
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

  it("uses the running balance up to the range end for pending when provided", () => {
    const running: RunningPlatformBalance[] = [
      { platform: "ebay", earned: 2095.79, expenses: 0, transferred: 885.83 },
      { platform: "amazon", earned: 10, expenses: 0, transferred: 0 },
    ];
    const b = computePlatformBalance("ebay", sales, expenses, payouts, running);
    // period figures are unchanged…
    expect(b).toEqual(expect.objectContaining({ balance: 875, transferred: 600 }));
    // …but "still in account" is everything earned minus everything transferred to date
    expect(b?.pending).toBeCloseTo(1209.96, 2);
    expect(b?.pendingIsRunning).toBe(true);
  });

  it("subtracts running platform-tagged expenses too", () => {
    const b = computePlatformBalance("ebay", sales, expenses, payouts, [
      { platform: "ebay", earned: 500, expenses: 40, transferred: 100 },
    ]);
    expect(b?.pending).toBe(360);
  });

  it("falls back to the period pending when the platform has no running row (RPC missing/failed)", () => {
    expect(computePlatformBalance("ebay", sales, expenses, payouts, [])).toEqual(
      expect.objectContaining({ pending: 275, pendingIsRunning: false })
    );
    expect(computePlatformBalance("ebay", sales, expenses, payouts, null)).toEqual(
      expect.objectContaining({ pending: 275, pendingIsRunning: false })
    );
  });
});

describe("runningBalanceAsOf", () => {
  const today = new Date(2026, 8, 30); // 30 Sep 2026, local
  it("uses the range end when it is in the past", () => {
    expect(runningBalanceAsOf("2026-08-31", today)).toBe("2026-08-31");
  });
  it("caps a future range end (e.g. This year) at today", () => {
    expect(runningBalanceAsOf("2026-12-31", today)).toBe("2026-09-30");
  });
  it("uses today for an open range (All time)", () => {
    expect(runningBalanceAsOf(null, today)).toBe("2026-09-30");
  });
});
