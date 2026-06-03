import {
  formatCurrency,
  calculateNetProfit,
  sumAmounts,
  calculateMargin,
} from "@/lib/utils/currency";

describe("formatCurrency", () => {
  it("formats EUR amounts with German locale", () => {
    const result = formatCurrency(1234.5, "EUR");
    // de-DE uses period as thousands separator and comma as decimal
    expect(result).toContain("1.234");
    expect(result).toContain("50");
    expect(result).toContain("€");
  });

  it("defaults to EUR when currency is omitted", () => {
    const result = formatCurrency(100);
    expect(result).toContain("€");
  });

  it("formats zero correctly", () => {
    const result = formatCurrency(0, "EUR");
    expect(result).toContain("0");
  });

  it("handles negative amounts", () => {
    const result = formatCurrency(-500, "EUR");
    expect(result).toContain("500");
    // Negative sign or minus symbol should appear
    expect(result).toMatch(/-|−/);
  });
});

describe("calculateNetProfit", () => {
  it("returns revenue minus expenses minus purchases", () => {
    expect(calculateNetProfit(1000, 200, 300)).toBe(500);
  });

  it("returns negative value when costs exceed revenue", () => {
    expect(calculateNetProfit(100, 200, 50)).toBe(-150);
  });

  it("returns zero when all inputs are zero", () => {
    expect(calculateNetProfit(0, 0, 0)).toBe(0);
  });
});

describe("sumAmounts", () => {
  it("sums an array of amounts", () => {
    expect(sumAmounts([10.5, 20.25, 5.0])).toBe(35.75);
  });

  it("returns 0 for an empty array", () => {
    expect(sumAmounts([])).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    // Floating point: 0.1 + 0.2 = 0.30000000000000004 without rounding
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
  });
});

describe("calculateMargin", () => {
  it("calculates gross margin percentage", () => {
    expect(calculateMargin(1000, 600)).toBe(40);
  });

  it("returns null when revenue is 0 (avoids division by zero)", () => {
    expect(calculateMargin(0, 500)).toBeNull();
  });

  it("returns 100% when cost is 0", () => {
    expect(calculateMargin(500, 0)).toBe(100);
  });

  it("returns negative margin when cost exceeds revenue", () => {
    expect(calculateMargin(100, 200)).toBe(-100);
  });
});
