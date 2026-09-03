import type { TenantPlan } from "@/types";

interface PlanLimits {
  maxUsers: number;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  /** Monthly pool of AI generations shared by the whole tenant. Enforced in
   * src/lib/ai/quota.ts; 0 wherever aiFeatures is false. */
  aiGenerationsPerMonth: number;
  // Messages + Listings specifically — Business only, stricter than the
  // general platformIntegrations gate (Pro + Business) the rest of the
  // Integrations-dependent features use.
  messagingAndListings: boolean;
}

const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  // Trial mirrors business: the product is sold as multi-platform
  // bookkeeping, so a trial that cannot connect eBay/Amazon cannot
  // demonstrate the product. Safe only because proxy.ts enforces
  // trial_ends_at — see isTrialExpired in lib/utils/trial.ts.
  trial:    { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  aiGenerationsPerMonth: 300, messagingAndListings: true  },
  starter:  { maxUsers: 3,        platformIntegrations: false, aiFeatures: false, aiGenerationsPerMonth: 0,   messagingAndListings: false },
  pro:      { maxUsers: 5,        platformIntegrations: true,  aiFeatures: false, aiGenerationsPerMonth: 0,   messagingAndListings: false },
  business: { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  aiGenerationsPerMonth: 300, messagingAndListings: true  },
};

export function getPlanLimits(plan: TenantPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function canAddUser(plan: TenantPlan, currentUserCount: number): boolean {
  return currentUserCount < PLAN_LIMITS[plan].maxUsers;
}

export function hasPlatformIntegrations(plan: TenantPlan): boolean {
  return PLAN_LIMITS[plan].platformIntegrations;
}

export function hasAiFeatures(plan: TenantPlan): boolean {
  return PLAN_LIMITS[plan].aiFeatures;
}

export function getAiGenerationLimit(plan: TenantPlan): number {
  return PLAN_LIMITS[plan].aiGenerationsPerMonth;
}

export function hasMessagingAndListings(plan: TenantPlan): boolean {
  return PLAN_LIMITS[plan].messagingAndListings;
}
