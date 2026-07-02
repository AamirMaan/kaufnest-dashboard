import type { Sale } from "@/types";
import { vatAmountFromGross } from "./currency";

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
