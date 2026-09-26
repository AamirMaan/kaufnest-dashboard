import { landedUnitCost } from "./landedCost";

describe("landedUnitCost", () => {
  it("excludes VAT and adds freight, customs and other costs", () => {
    // (121 − 21 + 10 + 5 + 5) / 10 — same case as the SQL test
    expect(
      landedUnitCost({ totalAmount: 121, vatAmount: 21, quantity: 10, freightCost: 10, customsCost: 5, otherCost: 5 }),
    ).toBe(12);
  });

  it("treats missing VAT and extras as zero", () => {
    expect(landedUnitCost({ totalAmount: 100, quantity: 10 })).toBe(10);
    expect(landedUnitCost({ totalAmount: 100, vatAmount: null, quantity: 10, freightCost: null })).toBe(10);
  });

  it("rounds to 4 decimals like numeric(14,4)", () => {
    expect(landedUnitCost({ totalAmount: 10, quantity: 3 })).toBe(3.3333);
  });

  it("returns null when quantity is not positive", () => {
    expect(landedUnitCost({ totalAmount: 10, quantity: 0 })).toBeNull();
    expect(landedUnitCost({ totalAmount: 10, quantity: -2 })).toBeNull();
    expect(landedUnitCost({ totalAmount: 10, quantity: Number.NaN })).toBeNull();
  });
});
