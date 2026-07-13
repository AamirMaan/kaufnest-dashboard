import {
  resolveDateRange,
  getPresetRange,
  filterSales,
  isRevenueSale,
  DEFAULT_SALES_FILTERS,
  sanitizeIlikeSearchTerm,
  isDefaultFilters,
  DEFAULT_PURCHASE_FILTERS,
} from "./filters";
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

describe("isRevenueSale", () => {
  it("returns true for a completed sale", () => {
    expect(isRevenueSale({ status: "completed" })).toBe(true);
  });

  it("returns false for a returned sale", () => {
    expect(isRevenueSale({ status: "returned" })).toBe(false);
  });

  it("returns false for a cancelled sale", () => {
    expect(isRevenueSale({ status: "cancelled" })).toBe(false);
  });

  it("returns true when status is null (unknown — count it)", () => {
    expect(isRevenueSale({ status: null })).toBe(true);
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

describe("sanitizeIlikeSearchTerm", () => {
  it("trims surrounding whitespace", () => {
    expect(sanitizeIlikeSearchTerm("  widget  ")).toBe("widget");
  });

  it("escapes backslashes first so later escapes aren't double-escaped", () => {
    expect(sanitizeIlikeSearchTerm("a\\b")).toBe("a\\\\b");
  });

  it("escapes ilike wildcards % and _", () => {
    expect(sanitizeIlikeSearchTerm("50% off_sale")).toBe("50\\% off\\_sale");
  });

  it("escapes commas so they can't inject an extra .or() condition", () => {
    expect(sanitizeIlikeSearchTerm("foo,bar")).toBe("foo\\,bar");
  });
});

describe("isDefaultFilters with search", () => {
  it("returns true when search is empty", () => {
    expect(isDefaultFilters(DEFAULT_PURCHASE_FILTERS)).toBe(true);
  });

  it("returns false when search is non-empty", () => {
    expect(isDefaultFilters({ ...DEFAULT_PURCHASE_FILTERS, search: "widget" })).toBe(false);
  });
});
