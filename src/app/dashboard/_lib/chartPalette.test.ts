import { chartTheme, compactMoney, seriesColor } from "./chartPalette";

describe("seriesColor", () => {
  it("uses the named color for known platforms and categories, case-insensitively", () => {
    expect(seriesColor("eBay", 3)).toBe("#3B82F6");
    expect(seriesColor("salary", 0)).toBe("#10B981");
  });

  it("falls back by index for unknown keys, deterministically", () => {
    expect(seriesColor("kaufland", 0)).toBe(seriesColor("otto", 5));
    expect(seriesColor("kaufland", 1)).not.toBe(seriesColor("kaufland", 0));
  });
});

describe("chartTheme", () => {
  it("switches grid/tick colors with the theme", () => {
    expect(chartTheme(true).grid).not.toBe(chartTheme(false).grid);
  });
});

describe("compactMoney", () => {
  it("abbreviates thousands with the currency symbol", () => {
    expect(compactMoney(1234, "EUR")).toBe("€1.2K");
    expect(compactMoney(350, "USD")).toBe("$350");
    expect(compactMoney(0, "EUR")).toBe("€0");
  });

  it("keeps the sign on negatives", () => {
    expect(compactMoney(-4000, "GBP")).toMatch(/^-£4K$/);
  });
});
