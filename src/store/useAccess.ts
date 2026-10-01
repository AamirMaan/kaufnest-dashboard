"use client";

import { useAppSelector } from "./hooks";
import { can as canAccess, effectiveAccess, type AccessLevel, type AccessMap, type Section } from "@/lib/permissions/sections";

/** Current user's section access. Before hydration falls back to role defaults (plan-capped). */
export function useAccess(): { access: AccessMap; can: (s: Section, min: AccessLevel) => boolean; level: (s: Section) => AccessLevel } {
  const stored = useAppSelector((s) => s.currentUser.access);
  const role = useAppSelector((s) => s.currentUser.profile?.role) ?? "accountant";
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const access = stored ?? effectiveAccess(role, {}, plan);
  return { access, can: (s, min) => canAccess(access, s, min), level: (s) => access[s] };
}
