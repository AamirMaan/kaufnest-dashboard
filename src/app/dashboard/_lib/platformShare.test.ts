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
