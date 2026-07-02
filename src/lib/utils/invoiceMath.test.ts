import { computeOrderInvoiceTotals, invoiceNumberFor } from "./invoiceMath";
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
