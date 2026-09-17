import { convertAmount, resolveSheetCurrency, applyRate } from "./convert";

describe("convertAmount", () => {
  it("multiplies amount by rate and rounds half-up to 2dp", () => {
    expect(convertAmount(4057.20, 0.0877)).toBe(355.82); // 4057.20 * 0.0877 = 355.816044 -> 355.82
  });

  it("rounds .xx5 up, not to even (half-up, not banker's rounding)", () => {
    expect(convertAmount(1, 0.125)).toBe(0.13); // 0.125 -> 0.13, not 0.12
  });

  it("returns 0 for a 0 amount regardless of rate", () => {
    expect(convertAmount(0, 0.0877)).toBe(0);
  });

  it("preserves sign for a negative amount (credit notes)", () => {
    expect(convertAmount(-100, 0.0877)).toBe(-8.77);
  });

  it("throws for a non-positive rate", () => {
    expect(() => convertAmount(100, 0)).toThrow();
    expect(() => convertAmount(100, -1)).toThrow();
  });
});

describe("resolveSheetCurrency", () => {
  it("treats a blank/undefined value as the base currency, no conversion needed", () => {
    expect(resolveSheetCurrency(undefined, "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
    expect(resolveSheetCurrency("", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
    expect(resolveSheetCurrency("   ", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
  });

  it("treats a value matching the base currency as no conversion needed", () => {
    expect(resolveSheetCurrency("eur", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
    expect(resolveSheetCurrency("EUR", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
  });

  it("recognizes a plausible ISO code different from base currency as needing conversion", () => {
    expect(resolveSheetCurrency("SEK", "EUR")).toEqual({ currency: "EUR", sheetCurrency: "SEK" });
    expect(resolveSheetCurrency("sek", "EUR")).toEqual({ currency: "EUR", sheetCurrency: "SEK" });
    expect(resolveSheetCurrency("PLN", "USD")).toEqual({ currency: "USD", sheetCurrency: "PLN" });
  });

  it("errors on a value that isn't a plausible 3-letter ISO code", () => {
    expect(resolveSheetCurrency("dollars", "EUR")).toEqual({ error: expect.stringContaining("unsupported currency") });
    expect(resolveSheetCurrency("12", "EUR")).toEqual({ error: expect.stringContaining("unsupported currency") });
  });
});

describe("applyRate", () => {
  const baseRow = { total_amount: 4057.20, vat_amount: 374.80 };

  it("converts total_amount and vat_amount, and records the original figures", () => {
    const result = applyRate(baseRow, "SEK", 0.0877, "2026-05-29");
    expect(result.total_amount).toBe(355.82); // 4057.20 * 0.0877
    expect(result.vat_amount).toBe(32.87); // 374.80 * 0.0877 = 32.86996 -> 32.87
    expect(result.original_currency).toBe("SEK");
    expect(result.original_total_amount).toBe(4057.20);
    expect(result.fx_rate).toBe(0.0877);
    expect(result.fx_rate_date).toBe("2026-05-29");
  });

  it("leaves vat_amount null when the row had none", () => {
    const result = applyRate({ total_amount: 100, vat_amount: null }, "USD", 0.92, "2026-06-01");
    expect(result.vat_amount).toBeNull();
  });

  it("does not mutate the input row", () => {
    const input = { total_amount: 100, vat_amount: 10 };
    applyRate(input, "USD", 0.92, "2026-06-01");
    expect(input).toEqual({ total_amount: 100, vat_amount: 10 });
  });
});
