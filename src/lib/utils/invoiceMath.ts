import type { Sale } from "@/types";
import { vatAmountFromGross } from "./currency";

// ─── Bulk totals (used by generateSalesInvoice + InvoiceModal) ────────────────

export interface BulkTotals {
  subtotal: number;   // sum of total_amount
  shipping: number;   // sum of shipping_charged ?? 0
  vat: number;        // sum of vat_amount ?? 0
  grandTotal: number; // subtotal + shipping (VAT-inclusive, Amazon-style)
}

export function computeBulkTotals(sales: Sale[]): BulkTotals {
  let subtotal = 0;
  let shipping = 0;
  let vat = 0;

  for (const s of sales) {
    subtotal += s.total_amount;
    shipping += s.shipping_charged ?? 0;
    vat += s.vat_amount ?? 0;
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    grandTotal: Math.round((subtotal + shipping) * 100) / 100,
  };
}

export interface OrderInvoiceTotals {
  itemsGross: number;   // sale.total_amount
  shipping: number;     // sale.shipping_charged ?? 0
  vatItems: number;     // sale.vat_amount ?? 0
  vatShipping: number;  // vat_rate != null ? vatAmountFromGross(shipping, vat_rate) : 0
  vatTotal: number;     // vatItems + vatShipping
  net: number;          // itemsGross + shipping - vatTotal
  grandTotal: number;   // itemsGross + shipping  (VAT-inclusive, Amazon-style)
}

export function computeOrderInvoiceTotals(sale: Sale): OrderInvoiceTotals {
  const itemsGross = sale.total_amount;
  const shipping = sale.shipping_charged ?? 0;
  const vatItems = sale.vat_amount ?? 0;

  // Calculate VAT on shipping: only if vat_rate is not null and not undefined
  const vatShipping =
    sale.vat_rate != null ? vatAmountFromGross(shipping, sale.vat_rate) : 0;

  const vatTotal = vatItems + vatShipping;
  const grandTotal = itemsGross + shipping;
  const net = grandTotal - vatTotal;

  return {
    itemsGross,
    shipping,
    vatItems,
    vatShipping,
    vatTotal,
    net,
    grandTotal,
  };
}

export function invoiceNumberFor(sale: Sale, prefix: string): string {
  const effectivePrefix = prefix || "INV-";
  const yearMonth = sale.date.slice(0, 7).replace("-", "");
  const saleIdPrefix = sale.id.slice(0, 8);
  return `${effectivePrefix}${yearMonth}-${saleIdPrefix}`;
}
