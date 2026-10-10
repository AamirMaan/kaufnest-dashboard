import type { IntegrationPlatform, PlatformAccount, TenantPlan } from "@/types";
import { getMaxAccountsPerPlatform } from "./planGating";

/**
 * Which connected seller accounts are usable under the tenant's plan.
 * Pure and client-safe: the Integrations page and the server routes share it,
 * so they can never disagree (spec: 2026-10-08-multi-account-integrations).
 *
 * Per platform, among status = "connected" rows:
 *  - is_active = false → paused by an admin, always.
 *  - the rest, oldest first, fill up to the plan's cap; beyond it → paused by
 *    the plan limit. After a downgrade the oldest accounts win by default; to
 *    keep others the admin pauses the ones they don't need.
 */
export type AccountLike = Pick<PlatformAccount, "id" | "platform" | "status" | "is_active" | "created_at">;

export type AccountState = "active" | "paused" | "plan_limit" | "disconnected" | "error";

const PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

/** Oldest first. Shared with `platformAccounts.accountOptionsFor` so pickers list accounts in cap order. */
export function byCreatedAt(a: Pick<AccountLike, "id" | "created_at">, b: Pick<AccountLike, "id" | "created_at">): number {
  // Compare instants, not strings (offset/precision differences), then break
  // ties on id so the ordering is deterministic. An unparseable timestamp
  // sorts as the epoch rather than poisoning the comparator with NaN.
  const diff = (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0);
  return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function eligible<T extends AccountLike>(rows: T[], platform: IntegrationPlatform): T[] {
  return rows
    .filter((r) => r.platform === platform && r.status === "connected" && r.is_active)
    .sort(byCreatedAt);
}

export function resolveActiveAccounts<T extends AccountLike>(
  rows: T[],
  plan: TenantPlan
): { active: T[]; paused: T[] } {
  const cap = getMaxAccountsPerPlatform(plan);
  const active: T[] = [];
  const paused: T[] = [];
  for (const platform of PLATFORMS) {
    const candidates = eligible(rows, platform);
    active.push(...candidates.slice(0, cap));
    paused.push(...candidates.slice(cap));
    paused.push(
      ...rows.filter((r) => r.platform === platform && r.status === "connected" && !r.is_active)
    );
  }
  return { active, paused };
}

export function accountState(rows: AccountLike[], id: string, plan: TenantPlan): AccountState {
  const row = rows.find((r) => r.id === id);
  if (!row || row.status === "disconnected") return "disconnected";
  if (row.status === "error") return "error";
  if (!row.is_active) return "paused";
  return resolveActiveAccounts(rows, plan).active.some((r) => r.id === id) ? "active" : "plan_limit";
}

/** Resuming is allowed only while the platform has fewer non-paused connected accounts than the cap. */
export function canResumeAccount(rows: AccountLike[], id: string, plan: TenantPlan): boolean {
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  const others = eligible(rows, row.platform).filter((r) => r.id !== id);
  return others.length < getMaxAccountsPerPlatform(plan);
}

/** Accounts that count against the cap when adding a new one: connected or errored (still holding tokens). */
export function connectedCount(rows: AccountLike[], platform: IntegrationPlatform): number {
  return rows.filter((r) => r.platform === platform && r.status !== "disconnected").length;
}

/**
 * The oldest connected, non-paused account of the platform. With any cap ≥ 1
 * this row is always inside the active set, so no plan lookup is needed.
 */
export function firstUsableAccount<T extends AccountLike>(rows: T[], platform: IntegrationPlatform): T | null {
  return eligible(rows, platform)[0] ?? null;
}
