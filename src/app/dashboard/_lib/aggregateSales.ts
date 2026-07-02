import type { Sale } from "@/types";
import { isRevenueSale } from "@/lib/utils/filters";

/**
 * Pure aggregation helper for revenue and fee calculations.
 *
 * Revenue includes:
 * - total_amount from the sale
 * - shipping_charged (when present, per B-4 spec)
 *
 * Fees include:
 * - shipping_cost (when present, per B-4 spec)
 * - advertising_fee (when present, per B-4 spec)
 *
 * Only counts revenue sales (not returned/cancelled).
 *
 * @param sales - array of Sale objects to aggregate
 * @returns object with revenue and fees totals
 */
export function aggregateSaleRevenue(
  sales: Sale[]
): { revenue: number; fees: number } {
  return sales.filter(isRevenueSale).reduce(
    (acc, s) => ({
      revenue: acc.revenue + s.total_amount + (s.shipping_charged ?? 0),
      fees: acc.fees + (s.shipping_cost ?? 0) + (s.advertising_fee ?? 0),
    }),
    { revenue: 0, fees: 0 }
  );
}
