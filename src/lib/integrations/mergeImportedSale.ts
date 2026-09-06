import type { Sale } from "@/types";

/**
 * Fields that only the platform (sync) can update. Everything else on
 * `Sale` is user-owned — preserved from `existing` on a re-import —
 * including the nine buyer-shipping-address fields added by migration 041
 * (`buyer_name`, `shipping_address_line1`, `shipping_address_line2`,
 * `shipping_city`, `shipping_state`, `shipping_postal_code`,
 * `shipping_country`, `buyer_phone`, `buyer_email`): a seller's manual
 * correction to a wrong or incomplete auto-captured address must survive a
 * later re-sync of the same order.
 */
const PLATFORM_OWNED: (keyof Sale)[] = [
  "status",
  "total_amount",
  "unit_price",
  "quantity",
  "product_name",
  "date",
  "description",
];

/**
 * Merges an incoming (platform-synced) sale row into an existing (possibly
 * manually-edited) row. Returns a new object that preserves user-owned fields
 * from `existing` and overwrites only platform-owned fields from `incoming`.
 *
 * When `existing` is undefined (new order), returns `incoming` unchanged.
 */
export function mergeImportedSale(
  existing: Sale | undefined,
  incoming: Sale
): Sale {
  if (!existing) return incoming;
  return {
    ...existing,
    ...Object.fromEntries(
      PLATFORM_OWNED.map((k) => [k, incoming[k]])
    ),
  } as Sale;
}
