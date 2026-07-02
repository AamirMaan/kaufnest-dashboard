import type { Sale } from "@/types";

/**
 * Compute the net proceeds of a sale:
 *   total_amount + shipping_charged − shipping_cost − advertising_fee
 *
 * All fee fields are `number | null` — treat null as zero.
 * `total_amount` is always present (non-nullable on Sale).
 */
export function computeNetProceeds(sale: Sale): number {
  return (
    (sale.total_amount ?? 0) +
    (sale.shipping_charged ?? 0) -
    (sale.shipping_cost ?? 0) -
    (sale.advertising_fee ?? 0)
  );
}
