import type { IntegrationPlatform, TenantPlan } from "@/types";
import { canAddAccount } from "@/lib/utils/planGating";
import { connectedCount, type AccountLike } from "@/lib/utils/activeAccounts";

export type ConnectionSummary = AccountLike & { external_account_id: string | null };

export type SaveDecision =
  | { kind: "update"; id: string }
  | { kind: "adopt"; id: string }
  | { kind: "insert" }
  | { kind: "limit" };

/**
 * What the OAuth callback does with a freshly authorised account.
 *  - same (platform, external_account_id) already stored → update it. A
 *    still-connected row is a token refresh and never hits the cap; a
 *    disconnected one is re-checked against the cap.
 *  - a legacy row with external_account_id NULL (pre-056 eBay) → adopt it,
 *    so its sales.connection_id links survive.
 *  - otherwise insert, if the plan allows another account.
 */
export function decideConnectionSave(
  rows: ConnectionSummary[],
  platform: IntegrationPlatform,
  externalAccountId: string,
  plan: TenantPlan
): SaveDecision {
  const samePlatform = rows.filter((r) => r.platform === platform);
  const hasRoom = canAddAccount(plan, connectedCount(rows, platform));

  const existing = samePlatform.find((r) => r.external_account_id === externalAccountId);
  if (existing) {
    if (existing.status !== "disconnected" || hasRoom) return { kind: "update", id: existing.id };
    return { kind: "limit" };
  }

  const legacy = samePlatform.find((r) => r.external_account_id === null);
  if (legacy && (legacy.status !== "disconnected" || hasRoom)) return { kind: "adopt", id: legacy.id };

  return hasRoom ? { kind: "insert" } : { kind: "limit" };
}

export function defaultDisplayName(
  platform: IntegrationPlatform,
  externalAccountId: string,
  username?: string
): string {
  if (platform === "ebay") return username ?? externalAccountId;
  return `Amazon – ${externalAccountId.slice(-6)}`;
}
