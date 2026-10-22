import type { IntegrationPlatform } from "@/types";

/**
 * Indexes of import items whose connection_id is not an ACTIVE account of the
 * item's own platform. The client sends connection_id back from the review
 * payload; the server never trusts it without this check.
 */
export function invalidImportItems(
  items: { platform: IntegrationPlatform; order: { connection_id?: string } }[],
  activeIds: Map<IntegrationPlatform, Set<string>>
): number[] {
  const bad: number[] = [];
  items.forEach((item, i) => {
    const id = item.order.connection_id;
    if (!id || !activeIds.get(item.platform)?.has(id)) bad.push(i);
  });
  return bad;
}

/**
 * Product ids in `productLinks` that are not in `knownIds`. The client picks
 * them from its own inventory list, but the server never trusts an id it has
 * not looked up in `products`.
 */
export function unknownProductIds(
  productLinks: Record<string, string>,
  knownIds: Set<string>
): string[] {
  return [...new Set(Object.values(productLinks))].filter((id) => !knownIds.has(id));
}
