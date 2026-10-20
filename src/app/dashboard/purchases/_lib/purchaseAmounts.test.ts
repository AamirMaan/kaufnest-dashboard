import { purchaseAmounts } from "./purchaseAmounts";

describe("purchaseAmounts", () => {
  it("derives the unit price from the total", () => {
    expect(purchaseAmounts("100", "4")).toEqual({ quantity: 4, total: 100, unitPrice: 25 });
  });

  it("rounds an uneven split to cents but keeps the entered total", () => {
    expect(purchaseAmounts("100", "3")).toEqual({ quantity: 3, total: 100, unitPrice: 33.33 });
  });

  it("rounds the total itself to cents, halves up", () => {
    expect(purchaseAmounts("10.005", "1").total).toBe(10.01);
    expect(purchaseAmounts("1.005", "1").total).toBe(1.01);
  });

  it("gives a 0 unit price when the total is too small for the quantity", () => {
    expect(purchaseAmounts("1", "300")).toEqual({ quantity: 300, total: 1, unitPrice: 0 });
  });

  it("treats empty, zero, negative or invalid totals as 0", () => {
    for (const t of ["", "0", "-5", "abc"]) {
      expect(purchaseAmounts(t, "2")).toEqual({ quantity: 2, total: 0, unitPrice: 0 });
    }
  });

  it("falls back to a quantity of 1", () => {
    expect(purchaseAmounts("50", "").quantity).toBe(1);
    expect(purchaseAmounts("50", "0")).toEqual({ quantity: 1, total: 50, unitPrice: 50 });
  });
});
