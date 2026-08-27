import { aggregateSaleRevenue } from "./aggregateSales";
import type { Sale } from "@/types";

// Test data factory
const makeSale = (overrides: Partial<Sale> = {}): Sale => {
  const defaults: Sale = {
    id: "test-sale-1",
    date: "2026-07-01",
    platform: "amazon",
    product_name: "Test Product",
    product_id: null,
    quantity: 1,
    unit_price: 100,
    total_amount: 100,
    shipping_cost: 5,
    advertising_fee: 10,
    vat_amount: null,
    currency: "EUR",
    status: "shipped",
    description: null,
    created_by: "test-user",
    created_at: "2026-07-01T00:00:00Z",
    vat_rate: null,
    restock: false,
    refunded_amount: null,
    external_order_id: null,
    shipping_charged: null,
    platform_fee: null,
  };
  return { ...defaults, ...overrides };
};

describe("aggregateSaleRevenue", () => {
  describe("basic revenue aggregation", () => {
    it("sums total_amount for basic sales", () => {
      const sales = [
        makeSale({ id: "s1", total_amount: 100 }),
        makeSale({ id: "s2", total_amount: 50 }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(150);
      expect(result.fees).toBe(30); // 2 sales × (5 + 10) fees each
    });

    it("returns zero for empty sales array", () => {
      const result = aggregateSaleRevenue([]);

      expect(result.revenue).toBe(0);
      expect(result.fees).toBe(0);
    });
  });

  describe("shipping_charged field (B-4 spec)", () => {
    it("adds shipping_charged to revenue when present", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          shipping_charged: 5,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(105); // 100 + 5 shipping_charged
    });

    it("treats missing shipping_charged as 0", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          shipping_charged: undefined,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(100); // 100 + 0 (undefined coalesced)
    });

    it("sums multiple shipping_charged values", () => {
      const sales = [
        makeSale({ id: "s1", total_amount: 100, shipping_charged: 5 }),
        makeSale({ id: "s2", total_amount: 50, shipping_charged: 3 }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(158); // (100+5) + (50+3)
    });
  });

  describe("fee fields (B-4 spec)", () => {
    it("sums shipping_cost + advertising_fee as fees", () => {
      const sales = [
        makeSale({
          id: "s1",
          shipping_cost: 2,
          advertising_fee: 3,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.fees).toBe(5); // 2 + 3
    });

    it("also sums platform_fee", () => {
      const sales = [
        makeSale({
          id: "s1",
          shipping_cost: 2,
          advertising_fee: 3,
          platform_fee: 4,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.fees).toBe(9); // 2 + 3 + 4
    });

    it("treats missing shipping_cost as 0", () => {
      const sales = [
        makeSale({
          id: "s1",
          shipping_cost: undefined,
          advertising_fee: 5,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.fees).toBe(5); // 0 (undefined) + 5
    });

    it("treats missing advertising_fee as 0", () => {
      const sales = [
        makeSale({
          id: "s1",
          shipping_cost: 5,
          advertising_fee: undefined,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.fees).toBe(5); // 5 + 0 (undefined)
    });

    it("sums multiple fee values", () => {
      const sales = [
        makeSale({
          id: "s1",
          shipping_cost: 2,
          advertising_fee: 3,
        }),
        makeSale({
          id: "s2",
          shipping_cost: 1,
          advertising_fee: 4,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.fees).toBe(10); // (2+3) + (1+4)
    });
  });

  describe("status filtering (revenue sales only)", () => {
    it("excludes returned sales from aggregation", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          status: "shipped",
        }),
        makeSale({
          id: "s2",
          total_amount: 50,
          status: "returned",
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(100); // only shipped sale counted
      expect(result.fees).toBe(15); // only shipped sale's fees counted
    });

    it("excludes cancelled sales from aggregation", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          status: "shipped",
        }),
        makeSale({
          id: "s2",
          total_amount: 50,
          status: "cancelled",
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(100); // only shipped sale counted
      expect(result.fees).toBe(15); // only shipped sale's fees counted
    });

    it("includes only valid revenue statuses", () => {
      const sales = [
        makeSale({ id: "s1", total_amount: 100, status: "shipped" }),
        makeSale({ id: "s2", total_amount: 50, status: "pending" }),
        makeSale({ id: "s3", total_amount: 30, status: "returned" }),
      ];

      const result = aggregateSaleRevenue(sales);

      // pending and shipped are revenue sales; returned is not
      expect(result.revenue).toBe(150); // 100 + 50
      expect(result.fees).toBe(30); // 2 revenue sales × (5 + 10) each
    });
  });

  describe("combined revenue + fee aggregation", () => {
    it("correctly aggregates both revenue and fees together", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          shipping_charged: 5,
          shipping_cost: 2,
          advertising_fee: 3,
        }),
        makeSale({
          id: "s2",
          total_amount: 50,
          shipping_charged: 2,
          shipping_cost: 1,
          advertising_fee: 2,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(157); // (100+5) + (50+2)
      expect(result.fees).toBe(8); // (2+3) + (1+2)
    });

    it("handles all nullish values correctly", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          shipping_charged: undefined,
          shipping_cost: undefined,
          advertising_fee: undefined,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(100); // 100 + 0
      expect(result.fees).toBe(0); // 0 + 0
    });
  });

  describe("edge cases", () => {
    it("handles zero-value fees and revenue", () => {
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 0,
          shipping_charged: 0,
          shipping_cost: 0,
          advertising_fee: 0,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(0);
      expect(result.fees).toBe(0);
    });

    it("handles negative values (refunds, credits)", () => {
      // While uncommon, the function should handle negative values correctly
      const sales = [
        makeSale({
          id: "s1",
          total_amount: 100,
          shipping_charged: -5, // refunded shipping
        }),
        makeSale({
          id: "s2",
          total_amount: -50, // refund
          shipping_cost: 0,
          advertising_fee: 0,
        }),
      ];

      const result = aggregateSaleRevenue(sales);

      expect(result.revenue).toBe(45); // (100 - 5) + (-50)
      expect(result.fees).toBe(15); // 2 sales × (5 + 10) each
    });
  });
});
