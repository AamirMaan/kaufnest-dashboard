import type { Sale, Purchase, Currency } from "@/types";

/**
 * Compute the net proceeds of a sale:
 *   total_amount + shipping_charged − shipping_cost − advertising_fee − platform_fee
 *
 * All fee fields are `number | null` — treat null as zero.
 * `total_amount` is always present (non-nullable on Sale).
 */
export function computeNetProceeds(sale: Sale): number {
  return (
    (sale.total_amount ?? 0) +
    (sale.shipping_charged ?? 0) -
    (sale.shipping_cost ?? 0) -
    (sale.advertising_fee ?? 0) -
    (sale.platform_fee ?? 0)
  );
}

/**
 * Net proceeds minus cost of goods. Returns null when no purchase is linked —
 * the order detail page should hide the Gross Profit row when null.
 */
export function computeGrossProfit(
  netProceeds: number,
  linkedPurchase: Pick<Purchase, "total_amount"> | null
): number | null {
  if (!linkedPurchase) return null;
  return netProceeds - linkedPurchase.total_amount;
}

export interface OrderCogs {
  amount: number;
  currency: Currency;
  source: "fifo" | "linked_purchase";
}

/**
 * Cost of goods for the order page: the FIFO amount the ledger booked
 * (sales.cogs_amount, advanced inventory) wins; otherwise a linked purchase
 * in the order's currency (mixed currencies would be meaningless); else none.
 */
export function resolveOrderCogs(
  sale: Pick<Sale, "cogs_amount" | "currency">,
  linkedPurchase: Pick<Purchase, "total_amount" | "currency"> | null,
): OrderCogs | null {
  if (sale.cogs_amount != null) return { amount: sale.cogs_amount, currency: sale.currency, source: "fifo" };
  if (linkedPurchase && linkedPurchase.currency === sale.currency) {
    return { amount: linkedPurchase.total_amount, currency: sale.currency, source: "linked_purchase" };
  }
  return null;
}

export function grossProfitFromCogs(netProceeds: number, cogs: OrderCogs | null): number | null {
  return cogs ? netProceeds - cogs.amount : null;
}
