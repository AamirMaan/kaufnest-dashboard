import type { Sale, Purchase } from "@/types";

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
