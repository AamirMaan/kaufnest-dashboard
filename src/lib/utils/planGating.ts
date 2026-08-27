import type { TenantPlan } from "@/types";

interface PlanLimits {
  maxUsers: number;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  // Messages + Listings specifically — Business only, stricter than the
  // general platformIntegrations gate (Pro + Business) the rest of the
  // Integrations-dependent features use.
  messagingAndListings: boolean;
}

const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial:    { maxUsers: 3,        platformIntegrations: false, aiFeatures: false, messagingAndListings: false },
  starter:  { maxUsers: 1,        platformIntegrations: false, aiFeatures: false, messagingAndListings: false },
  pro:      { maxUsers: 5,        platformIntegrations: true,  aiFeatures: false, messagingAndListings: false },
  business: { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  messagingAndListings: true  },
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

export function hasMessagingAndListings(plan: TenantPlan): boolean {
  return PLAN_LIMITS[plan].messagingAndListings;
}
