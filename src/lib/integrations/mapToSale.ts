import type { Currency, IntegrationPlatform, Sale } from "@/types";
import type { NormalizedOrder } from "./types";

export type SaleInsert = Omit<Sale, "id" | "created_at">;

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

function normalizeCurrency(value: string): Currency {
  return (CURRENCIES as string[]).includes(value) ? (value as Currency) : "EUR";
}

/**
 * Maps a platform-agnostic `NormalizedOrder` to a `sales` insert row.
 * Synced orders are never linked to inventory (`product_id: null`) and never
 * carry VAT (`vat_rate`/`vat_amount: null`) — both stay editable later via
 * the Edit Sale modal. `external_order_id` + `platform` form the dedup key
 * used by `sync.ts`'s upsert.
 */
export function normalizedOrderToSaleRow(
  order: NormalizedOrder,
  platform: IntegrationPlatform,
  connectedBy: string
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
    advertising_fee: null,
    status: order.status,
    restock: false,
    refunded_amount: null,
    external_order_id: order.external_order_id,
  };
}
