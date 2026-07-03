import { computeOrderInvoiceTotals, computeBulkTotals, invoiceNumberFor } from "./invoiceMath";
import { vatAmountFromGross } from "./currency";
import type { Sale } from "@/types";

describe("invoiceMath", () => {
  describe("computeOrderInvoiceTotals", () => {
    it("should handle no VAT, no shipping", () => {
      const sale: Partial<Sale> = {
        id: "test-id",
        date: "2024-03-15",
        total_amount: 100,
        vat_amount: null,
        vat_rate: null,
        shipping_charged: null,
      };

      const result = computeOrderInvoiceTotals(sale as Sale);

      expect(result.itemsGross).toBe(100);
      expect(result.shipping).toBe(0);
      expect(result.vatItems).toBe(0);
      expect(result.vatShipping).toBe(0);
      expect(result.vatTotal).toBe(0);
      expect(result.net).toBe(100);
      expect(result.grandTotal).toBe(100);
    });

    it("should handle VAT only, no shipping", () => {
      const sale: Partial<Sale> = {
        id: "test-id",
        date: "2024-03-15",
        total_amount: 119,
        vat_amount: 19,
        vat_rate: 19,
        shipping_charged: null,
      };

      const result = computeOrderInvoiceTotals(sale as Sale);

      expect(result.itemsGross).toBe(119);
      expect(result.shipping).toBe(0);
      expect(result.vatItems).toBe(19);
      expect(result.vatShipping).toBe(0);
      expect(result.vatTotal).toBe(19);
      expect(result.net).toBe(100);
      expect(result.grandTotal).toBe(119);
    });

    it("should handle shipping only, no VAT", () => {
      const sale: Partial<Sale> = {
        id: "test-id",
        date: "2024-03-15",
        total_amount: 100,
        vat_amount: null,
        vat_rate: null,
        shipping_charged: 9.99,
      };

      const result = computeOrderInvoiceTotals(sale as Sale);

      expect(result.itemsGross).toBe(100);
      expect(result.shipping).toBe(9.99);
      expect(result.vatItems).toBe(0);
      expect(result.vatShipping).toBe(0);
      expect(result.vatTotal).toBe(0);
      expect(result.net).toBe(109.99);
      expect(result.grandTotal).toBe(109.99);
    });

    it("should handle both VAT and shipping", () => {
      const sale: Partial<Sale> = {
        id: "test-id",
        date: "2024-03-15",
        total_amount: 119,
        vat_amount: 19,
        vat_rate: 19,
        shipping_charged: 9.99,
      };

      const result = computeOrderInvoiceTotals(sale as Sale);
      const expectedVatShipping = vatAmountFromGross(9.99, 19);

      expect(result.itemsGross).toBe(119);
      expect(result.shipping).toBe(9.99);
      expect(result.vatItems).toBe(19);
      expect(result.vatShipping).toBe(expectedVatShipping);
      expect(result.vatTotal).toBe(19 + expectedVatShipping);
      expect(result.net).toBe(128.99 - result.vatTotal);
      expect(result.grandTotal).toBe(128.99);
    });

    it("should handle rounding correctly", () => {
      const sale: Partial<Sale> = {
        id: "test-id",
        date: "2024-03-15",
        total_amount: 119.0,
        vat_amount: 19.0,
        vat_rate: 19,
        shipping_charged: null,
      };

      const result = computeOrderInvoiceTotals(sale as Sale);

      expect(result.grandTotal).toBe(119.0);
      expect(result.net).toBe(100.0);
      expect(result.vatTotal).toBe(19.0);
    });

    it("should handle zero-rated VAT (vat_rate=0)", () => {
      const sale: Partial<Sale> = {
        id: "test-id",
        date: "2024-03-15",
        total_amount: 100,
        vat_amount: 0,
        vat_rate: 0,
        shipping_charged: 10,
      };

      const result = computeOrderInvoiceTotals(sale as Sale);
      const expectedVatShipping = vatAmountFromGross(10, 0);

      expect(result.itemsGross).toBe(100);
      expect(result.shipping).toBe(10);
      expect(result.vatItems).toBe(0);
      expect(result.vatShipping).toBe(expectedVatShipping);
      expect(result.vatTotal).toBe(0);
      expect(result.grandTotal).toBe(110);
      expect(result.net).toBe(110);
    });
  });

  describe("computeBulkTotals", () => {
    it("empty array → all zeros", () => {
      const result = computeBulkTotals([]);
      expect(result.subtotal).toBe(0);
      expect(result.shipping).toBe(0);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(0);
    });

    it("single sale without shipping or VAT", () => {
      const sale: Partial<Sale> = {
        id: "s1",
        date: "2024-05-01",
        total_amount: 100,
        shipping_charged: null,
        vat_amount: null,
        currency: "EUR",
      };
      const result = computeBulkTotals([sale as Sale]);
      expect(result.subtotal).toBe(100);
      expect(result.shipping).toBe(0);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(100);
    });

    it("single sale with shipping and VAT", () => {
      const sale: Partial<Sale> = {
        id: "s2",
        date: "2024-05-01",
        total_amount: 119,
        shipping_charged: 9.99,
        vat_amount: 19,
        currency: "EUR",
      };
      const result = computeBulkTotals([sale as Sale]);
      expect(result.subtotal).toBe(119);
      expect(result.shipping).toBe(9.99);
      expect(result.vat).toBe(19);
      expect(result.grandTotal).toBe(128.99); // subtotal + shipping
    });

    it("multi-sale array sums each field correctly", () => {
      const sales: Partial<Sale>[] = [
        { id: "s3", date: "2024-05-01", total_amount: 50, shipping_charged: 5, vat_amount: 5, currency: "EUR" },
        { id: "s4", date: "2024-05-02", total_amount: 80, shipping_charged: 10, vat_amount: 8, currency: "EUR" },
        { id: "s5", date: "2024-05-03", total_amount: 20, shipping_charged: null, vat_amount: null, currency: "EUR" },
      ];
      const result = computeBulkTotals(sales as Sale[]);
      expect(result.subtotal).toBe(150);      // 50 + 80 + 20
      expect(result.shipping).toBe(15);       // 5 + 10 + 0
      expect(result.vat).toBe(13);            // 5 + 8 + 0
      expect(result.grandTotal).toBe(165);    // 150 + 15
    });

    it("mixed-currency array sums numerically (caller groups by currency)", () => {
      // computeBulkTotals is currency-agnostic; caller is responsible for grouping.
      // This test verifies the function sums without filtering.
      const sales: Partial<Sale>[] = [
        { id: "s6", date: "2024-05-01", total_amount: 100, shipping_charged: 10, vat_amount: 10, currency: "EUR" },
        { id: "s7", date: "2024-05-02", total_amount: 200, shipping_charged: 20, vat_amount: 20, currency: "USD" },
      ];
      const result = computeBulkTotals(sales as Sale[]);
      expect(result.subtotal).toBe(300);
      expect(result.shipping).toBe(30);
      expect(result.vat).toBe(30);
      expect(result.grandTotal).toBe(330);
    });
  });

  describe("invoiceNumberFor", () => {
    it("should generate invoice number with custom prefix", () => {
      const sale: Partial<Sale> = {
        id: "abc12345-rest",
        date: "2024-03-15",
      };

      const result = invoiceNumberFor(sale as Sale, "ORD-");

      expect(result).toBe("ORD-202403-abc12345");
    });

    it("should fall back to INV- prefix when empty string is passed", () => {
      const sale: Partial<Sale> = {
        id: "abc12345-rest",
        date: "2024-03-15",
      };

      const result = invoiceNumberFor(sale as Sale, "");

      expect(result).toBe("INV-202403-abc12345");
    });

    it("should handle different month dates", () => {
      const sale: Partial<Sale> = {
        id: "xyz99999-rest",
        date: "2025-11-01",
      };

      const result = invoiceNumberFor(sale as Sale, "INV-");

      expect(result).toBe("INV-202511-xyz99999");
    });
  });
});
