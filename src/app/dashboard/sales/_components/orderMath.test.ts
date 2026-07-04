import { computeNetProceeds, computeGrossProfit } from "./orderMath";
import type { Sale, Purchase } from "@/types";

/** Minimal Sale factory — only fields needed for orderMath */
function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "test-id",
    platform: "amazon",
    product_name: "Test Product",
    product_id: null,
    quantity: 1,
    unit_price: 10,
    total_amount: 10,
    currency: "EUR",
    date: "2024-01-01",
    description: null,
    created_by: "user-1",
    created_at: "2024-01-01T00:00:00Z",
    vat_rate: null,
    vat_amount: null,
    shipping_cost: null,
    shipping_charged: null,
    advertising_fee: null,
    status: "pending",
    restock: false,
    external_order_id: null,
    ...overrides,
  };
}

describe("computeNetProceeds", () => {
  it("returns total_amount when all fee fields are null", () => {
    const sale = makeSale({ total_amount: 50 });
    expect(computeNetProceeds(sale)).toBe(50);
  });

  it("computes correct net when all fields are set", () => {
    // 100 + 10 - 5 - 2 = 103
    const sale = makeSale({
      total_amount: 100,
      shipping_charged: 10,
      shipping_cost: 5,
      advertising_fee: 2,
    });
    expect(computeNetProceeds(sale)).toBe(103);
  });

  it("handles a returned order with zero total_amount without error", () => {
    const sale = makeSale({
      total_amount: 0,
      status: "returned",
      shipping_cost: 5,
      advertising_fee: 2,
    });
    // 0 + 0 - 5 - 2 = -7
    expect(computeNetProceeds(sale)).toBe(-7);
  });

  it("handles partial: only shipping_charged set", () => {
    // 30 + 8 - 0 - 0 = 38
    const sale = makeSale({ total_amount: 30, shipping_charged: 8 });
    expect(computeNetProceeds(sale)).toBe(38);
  });
});

describe("computeGrossProfit", () => {
  it("returns null when linkedPurchase is null", () => {
    expect(computeGrossProfit(100, null)).toBeNull();
  });

  it("subtracts purchase total_amount from netProceeds", () => {
    expect(computeGrossProfit(120.99, { total_amount: 68 })).toBeCloseTo(52.99);
  });

  it("returns netProceeds unchanged when purchase cost is zero", () => {
    expect(computeGrossProfit(50, { total_amount: 0 })).toBe(50);
  });

  it("returns negative when purchase exceeds net proceeds (loss scenario)", () => {
    expect(computeGrossProfit(30, { total_amount: 80 })).toBe(-50);
  });
});
