import type { TenantPlan } from "@/types";

interface PlanLimits {
  maxUsers: number;
  platformIntegrations: boolean;
  aiFeatures: boolean;
}

const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial:    { maxUsers: 3,        platformIntegrations: false, aiFeatures: false },
  starter:  { maxUsers: 1,        platformIntegrations: false, aiFeatures: false },
  pro:      { maxUsers: 5,        platformIntegrations: true,  aiFeatures: false },
  business: { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true  },
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
