import type { Sale } from "@/types";

/** Fields that only the platform (sync) can update. */
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
