"use client";

import { useAppSelector } from "./hooks";
import { availabilityLine, type PlanEntitlements, type PlanFeature } from "@/lib/plans/entitlements";

/**
 * The tenant's plan entitlements (null until hydrated — treat as "not
 * entitled") and the upgrade-screen sentence for a feature, derived from
 * which PUBLIC plans include it (control.plans) instead of hardcoded copy.
 */
export function usePlan(): {
  ent: PlanEntitlements | null;
  availability: (feature: PlanFeature, subject: string) => string;
} {
  const ent = useAppSelector((s) => s.currentUser.planEntitlements);
  const names = useAppSelector((s) => s.currentUser.planNamesByFeature);
  return {
    ent,
    availability: (feature, subject) => availabilityLine(subject, names?.[feature] ?? []),
  };
}
