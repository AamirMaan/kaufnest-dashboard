/**
 * Which of a tenant's eBay connections an eBay MARKETPLACE_ACCOUNT_DELETION
 * notification refers to. Matches on the Identity userId, or the username
 * for rows connected before 056 stored the userId. Pure — the route does the I/O.
 */
export function matchDeletedEbayConnections(
  rows: { id: string; external_account_id: string | null; external_username: string | null }[],
  userId?: string,
  username?: string
): string[] {
  return rows
    .filter(
      (r) =>
        (userId && r.external_account_id === userId) ||
        (username && (r.external_username === username || r.external_account_id === username))
    )
    .map((r) => r.id);
}

/**
 * Whether a deletion must also remove the tenant's UNASSIGNED synced eBay
 * orders (connection_id NULL — e.g. CSV imports left unassigned, or orders an
 * admin set to Unassigned). True when the deleted account(s) are every eBay
 * account the tenant has: those orders can only be that seller's, and
 * pre-multi-account behaviour deleted every synced eBay order. With other
 * eBay accounts left we can't attribute them, so only the matched account's
 * orders go.
 */
export function deletesUnassignedOrders(allEbayConnectionIds: string[], matchedIds: string[]): boolean {
  const matched = new Set(matchedIds);
  return matched.size > 0 && allEbayConnectionIds.every((id) => matched.has(id));
}
