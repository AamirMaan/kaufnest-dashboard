import type { Currency, IntegrationPlatform, Sale } from "@/types";
import type { NormalizedOrder } from "./types";

export type SaleInsert = Omit<Sale, "id" | "created_at">;

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

function normalizeCurrency(value: string): Currency {
  return (CURRENCIES as string[]).includes(value) ? (value as Currency) : "EUR";
}

export interface ReviewOrderFees {
  advertisingFee: number | null;
  platformFee: number | null;
}

/**
 * Maps a platform-agnostic `NormalizedOrder` to a `sales` insert row.
 * Synced orders are never linked to inventory (`product_id: null`) and never
 * carry VAT (`vat_rate`/`vat_amount: null`) — both stay editable later via
 * the Edit Sale modal. `external_order_id` + `platform` form the dedup key
 * used by `sync.ts`'s upsert.
 *
 * `fees` is optional (defaults to both null) — the Review Orders page lets a
 * user enter advertising_fee/platform_fee per order (or via a bulk
 * percent-of-item-total apply) before import, since neither eBay's nor
 * Amazon's order-listing API returns a fee breakdown at that granularity.
 * `shipping_cost`/`shipping_charged` stay null either way — filling those in
 * remains a manual Edit Sale step, same as before this change.
 */
export function normalizedOrderToSaleRow(
  order: NormalizedOrder,
  platform: IntegrationPlatform,
  connectedBy: string,
  fees?: ReviewOrderFees
): SaleInsert {
  return {
    platform,
    product_name: order.product_name,
    product_id: null,
    quantity: order.quantity,
    unit_price: order.unit_price,
    total_amount: order.total_amount,
    currency: normalizeCurrency(order.currency),
    date: order.date,
    description: order.description,
    created_by: connectedBy,
    vat_rate: null,
    vat_amount: null,
    shipping_cost: null,
    shipping_charged: null,
    advertising_fee: fees?.advertisingFee ?? null,
    platform_fee: fees?.platformFee ?? null,
    status: order.status,
    restock: false,
    refunded_amount: null,
    external_order_id: order.external_order_id,
  };
}
