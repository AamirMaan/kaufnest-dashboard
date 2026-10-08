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
