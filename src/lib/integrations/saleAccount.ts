import type { AccountLike } from "@/lib/utils/activeAccounts";
import type { IntegrationErrorCode } from "@/lib/utils/integrationErrors";

export type SaleAccountResult<T> = { ok: true; account: T } | { ok: false; code: IntegrationErrorCode };

/**
 * Which eBay account pushes a status change (ship/cancel) for a synced sale.
 * Pure — the route loads `rows` (every connection).
 *  - the sale's own connection_id, if set: it must be a connected eBay row.
 *  - unassigned (connection_id NULL): only when the tenant has exactly one
 *    eBay account still holding tokens; with several we can't know which one
 *    owns the order, and guessing would send it to the wrong seller.
 * Deliberately ignores pause / the plan cap: fulfilling an order that already
 * exists must keep working after its account is paused (see SKILL.md).
 */
export function resolveSaleEbayAccount<T extends AccountLike>(
  rows: T[],
  connectionId: string | null | undefined
): SaleAccountResult<T> {
  const ebayRows = rows.filter((r) => r.platform === "ebay");
  const live = ebayRows.filter((r) => r.status !== "disconnected");
  if (!connectionId && live.length > 1) return { ok: false, code: "INTEGRATION_ACCOUNT_AMBIGUOUS" };
  const account = connectionId ? ebayRows.find((r) => r.id === connectionId) : live[0];
  if (!account) {
    return { ok: false, code: connectionId ? "INTEGRATION_ACCOUNT_UNKNOWN" : "INTEGRATION_ACCOUNT_DISCONNECTED" };
  }
  if (account.status !== "connected") return { ok: false, code: "INTEGRATION_ACCOUNT_DISCONNECTED" };
  return { ok: true, account };
}
