import { resolveDateRange, getPresetRange, filterSales, DEFAULT_SALES_FILTERS } from "./filters";
import type { Sale } from "@/types";

describe("resolveDateRange", () => {
  it("delegates non-custom presets to getPresetRange", () => {
    expect(resolveDateRange("this_month", "", "")).toEqual(getPresetRange("this_month"));
    expect(resolveDateRange("all", "", "")).toBeNull();
  });

  it("returns null for custom preset with no bounds set", () => {
    expect(resolveDateRange("custom", "", "")).toBeNull();
  });

  it("returns the exact bounds for a fully specified custom range", () => {
    expect(resolveDateRange("custom", "2026-01-01", "2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("fills in an open lower bound when only 'to' is given", () => {
    expect(resolveDateRange("custom", "", "2026-03-31")).toEqual({
      from: "0000-00-00",
      to: "2026-03-31",
    });
  });

  it("fills in an open upper bound when only 'from' is given", () => {
    expect(resolveDateRange("custom", "2026-01-01", "")).toEqual({
      from: "2026-01-01",
      to: "9999-99-99",
    });
  });
});

function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "s1",
    platform: "amazon",
    product_name: "Widget",
    product_id: null,
    quantity: 1,
    unit_price: 10,
    total_amount: 10,
    currency: "EUR",
    date: "2026-01-15",
    description: null,
    created_by: "user-1",
    created_at: "2026-01-15T00:00:00Z",
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

describe("filterSales", () => {
  it("returns all sales when status filter is 'all'", () => {
    const pending = makeSale({ id: "s1", status: "pending" });
    const returned = makeSale({ id: "s2", status: "returned" });

    expect(filterSales([pending, returned], DEFAULT_SALES_FILTERS)).toEqual([pending, returned]);
  });

  it("filters to only the selected status", () => {
    const pending = makeSale({ id: "s1", status: "pending" });
    const returned = makeSale({ id: "s2", status: "returned" });

    expect(filterSales([pending, returned], { ...DEFAULT_SALES_FILTERS, status: "returned" })).toEqual([returned]);
  });

  it("matches custom ('Other') status values exactly", () => {
    const custom = makeSale({ id: "s1", status: "awaiting customs" });
    const pending = makeSale({ id: "s2", status: "pending" });

    expect(filterSales([custom, pending], { ...DEFAULT_SALES_FILTERS, status: "awaiting customs" })).toEqual([custom]);
  });
});
