import { marketplaceShares } from "./marketplaceRows";
import type { MarketplaceRow } from "./overviewTypes";

const r = (marketplace: string | null, revenue: number): MarketplaceRow => ({
  marketplace, order_count: 1, revenue, vat: 0, vat_base: 0,
});

describe("marketplaceShares", () => {
  it("sorts by revenue desc, labels null as Unknown, computes share of the positive total", () => {
    const { total, rows } = marketplaceShares([r("amazon.fr", 25), r(null, 25), r("amazon.de", 50)]);
    expect(total).toBe(100);
    expect(rows.map((x) => x.label)).toEqual(["amazon.de", "amazon.fr", "Unknown"]);
    expect(rows.map((x) => x.sharePct)).toEqual([50, 25, 25]);
  });

  it("puts Unknown last on a revenue tie", () => {
    expect(marketplaceShares([r(null, 10), r("ebay.de", 10)]).rows.map((x) => x.label)).toEqual(["ebay.de", "Unknown"]);
  });

  it("negative-revenue rows get 0% and don't inflate the total", () => {
    const { total, rows } = marketplaceShares([r("amazon.de", 100), r("amazon.it", -20)]);
    expect(total).toBe(100);
    expect(rows.find((x) => x.label === "amazon.it")?.sharePct).toBe(0);
  });

  it("empty input → zero total, no rows", () => {
    expect(marketplaceShares([])).toEqual({ total: 0, rows: [] });
  });
});
