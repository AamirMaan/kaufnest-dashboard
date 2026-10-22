export interface MatchableProduct {
  id: string;
  name: string;
  sku?: string | null;
}

export interface InventoryMatch {
  productId: string;
  reason: "sku" | "name";
}

const normSku = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const normName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Suggests the inventory item for an order line: exact SKU first, then exact
 * normalised name. More than one candidate at a step proposes nothing — a
 * wrong auto-link would deduct the wrong stock and notify the wrong location.
 */
export function matchInventory(
  order: { sku?: string | null; product_name: string },
  products: MatchableProduct[]
): InventoryMatch | null {
  const sku = normSku(order.sku);
  if (sku) {
    const hits = products.filter((p) => normSku(p.sku) === sku);
    if (hits.length === 1) return { productId: hits[0].id, reason: "sku" };
    if (hits.length > 1) return null;
  }
  const name = normName(order.product_name);
  if (!name) return null;
  const hits = products.filter((p) => normName(p.name) === name);
  return hits.length === 1 ? { productId: hits[0].id, reason: "name" } : null;
}
