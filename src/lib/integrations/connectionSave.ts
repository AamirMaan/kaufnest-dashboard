import type { IntegrationPlatform } from "@/types";
import { canAddAccount, type PlanEntitlements } from "@/lib/plans/entitlements";
import { connectedCount, type AccountLike } from "@/lib/utils/activeAccounts";

export type ConnectionSummary = AccountLike & { external_account_id: string | null };

export type SaveDecision =
  | { kind: "update"; id: string }
  | { kind: "adopt"; id: string }
  | { kind: "insert" }
  | { kind: "limit" }
  | { kind: "legacy_pending" };

/**
 * A pre-056 eBay row: no external_account_id, so we can't tell which seller
 * account it belongs to until the admin reconnects THAT row. Disconnected
 * legacy rows hold no tokens and don't block adding accounts.
 */
function isPendingLegacy(r: ConnectionSummary): boolean {
  return r.external_account_id === null && r.status !== "disconnected";
}

/**
 * What the OAuth callback does with a freshly authorised account.
 *  - same (platform, external_account_id) already stored → update it. A
 *    still-connected row is a token refresh and never hits the cap; a
 *    disconnected one is re-checked against the cap.
 *  - the admin explicitly reconnected a legacy row (targetId, from the
 *    connect route's ?reconnect=<id>) → adopt it, so its sales.connection_id
 *    links survive. A legacy row is NEVER adopted implicitly: an "Add
 *    account" sign-in may be a different seller, and adopting would hand it
 *    the legacy account's order history.
 *  - a non-disconnected legacy row exists but wasn't the target → refuse
 *    (legacy_pending): inserting could duplicate the legacy account.
 *  - otherwise insert, if the plan allows another account.
 */
export function decideConnectionSave(
  rows: ConnectionSummary[],
  platform: IntegrationPlatform,
  externalAccountId: string,
  ent: PlanEntitlements,
  targetId: string | null = null
): SaveDecision {
  const samePlatform = rows.filter((r) => r.platform === platform);
  const hasRoom = canAddAccount(ent, connectedCount(rows, platform));

  const existing = samePlatform.find((r) => r.external_account_id === externalAccountId);
  if (existing) {
    if (existing.status !== "disconnected" || hasRoom) return { kind: "update", id: existing.id };
    return { kind: "limit" };
  }

  const target = targetId ? samePlatform.find((r) => r.id === targetId) : undefined;
  if (target && target.external_account_id === null) {
    return target.status !== "disconnected" || hasRoom ? { kind: "adopt", id: target.id } : { kind: "limit" };
  }

  if (samePlatform.some(isPendingLegacy)) return { kind: "legacy_pending" };

  return hasRoom ? { kind: "insert" } : { kind: "limit" };
}

export type ConnectPrecheck = "ok" | "limit" | "legacy_pending" | "unknown_target";

/**
 * The connect route's early check, before sending the admin to the platform.
 * A reconnect (targetId) skips the cap — the callback re-checks it via
 * decideConnectionSave. Mirrors that function's legacy rule so "Add account"
 * fails fast instead of after the OAuth round-trip.
 */
export function connectPrecheck(
  rows: ConnectionSummary[],
  platform: IntegrationPlatform,
  ent: PlanEntitlements,
  targetId: string | null
): ConnectPrecheck {
  const samePlatform = rows.filter((r) => r.platform === platform);
  if (targetId) return samePlatform.some((r) => r.id === targetId) ? "ok" : "unknown_target";
  if (samePlatform.some(isPendingLegacy)) return "legacy_pending";
  return canAddAccount(ent, connectedCount(rows, platform)) ? "ok" : "limit";
}

export function defaultDisplayName(
  platform: IntegrationPlatform,
  externalAccountId: string,
  username?: string
): string {
  if (platform === "ebay") return username ?? externalAccountId;
  return `Amazon – ${externalAccountId.slice(-6)}`;
}

/** The names 056 backfilled for rows it couldn't identify — keep in sync with its UPDATE. */
const MIGRATION_PLACEHOLDER_NAMES = new Set(["eBay account", "Amazon – account"]);

/**
 * The display_name to write when saving an authorised account, or undefined
 * to keep the stored one. An admin's rename always survives; an empty name or
 * 056's generic placeholder is replaced with the real account name.
 */
export function displayNameForSave(
  decision: SaveDecision,
  storedName: string | null | undefined,
  name: string
): string | undefined {
  if (decision.kind === "insert") return name;
  if (!storedName || MIGRATION_PLACEHOLDER_NAMES.has(storedName)) return name;
  return undefined;
}
