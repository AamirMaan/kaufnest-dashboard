import type { TenantPlan } from "@/types";

/**
 * True when a tenant is on the trial plan and its trial window has closed.
 *
 * Fail-open on missing/garbage dates: `proxy.ts` already treats an
 * unreachable control plane as "let them through", and locking a tenant out
 * of their own data because a timestamp failed to parse is a far worse
 * outcome than a trial running slightly long.
 */
export function isTrialExpired(
  plan: TenantPlan,
  trialEndsAt: string | null,
  now: Date = new Date()
): boolean {
  if (plan !== "trial") return false;
  if (!trialEndsAt) return false;

  const endsAt = new Date(trialEndsAt).getTime();
  if (Number.isNaN(endsAt)) return false;

  return endsAt <= now.getTime();
}
