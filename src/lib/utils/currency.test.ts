import {
  formatCurrency,
  calculateNetProfit,
  sumAmounts,
  calculateMargin,
  vatAmountFromGross,
} from "./currency";

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

  it("formats USD amounts and includes dollar symbol", () => {
    const result = formatCurrency(99.99, "USD");
    expect(result).toContain("99");
    expect(result).toMatch(/\$|USD/);
  });

  it("formats GBP amounts and includes pound symbol", () => {
    const result = formatCurrency(50, "GBP");
    expect(result).toMatch(/£|GBP/);
  });

  it("formats large amounts correctly", () => {
    const result = formatCurrency(1_000_000, "EUR");
    expect(result).toContain("€");
    expect(result).toContain("1");
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

  it("handles decimal values correctly", () => {
    expect(calculateNetProfit(1000.50, 200.25, 300.25)).toBe(500);
  });

  it("returns revenue when costs are zero", () => {
    expect(calculateNetProfit(750, 0, 0)).toBe(750);
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

  it("handles a single-element array", () => {
    expect(sumAmounts([42.99])).toBe(42.99);
  });

  it("handles large arrays", () => {
    const amounts = Array.from({ length: 100 }, () => 1.01);
    expect(sumAmounts(amounts)).toBe(101);
  });

  it("handles negative amounts in the array", () => {
    expect(sumAmounts([100, -30, 20])).toBe(90);
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

  it("returns 0% margin when cost equals revenue", () => {
    expect(calculateMargin(500, 500)).toBe(0);
  });

  it("returns 50% margin when cost is half of revenue", () => {
    expect(calculateMargin(200, 100)).toBe(50);
  });
});

describe("vatAmountFromGross", () => {
  it("extracts the VAT portion from a VAT-inclusive gross amount", () => {
    expect(vatAmountFromGross(119, 19)).toBe(19);
  });

  it("returns 0 when the rate is 0", () => {
    expect(vatAmountFromGross(100, 0)).toBe(0);
  });

  it("returns 0 when the rate is negative", () => {
    expect(vatAmountFromGross(100, -5)).toBe(0);
  });

  it("returns 0 when gross is 0", () => {
    expect(vatAmountFromGross(0, 19)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    expect(vatAmountFromGross(100, 19)).toBe(15.97);
  });

  it("handles a reduced rate (e.g. 7%)", () => {
    expect(vatAmountFromGross(107, 7)).toBe(7);
  });
});
