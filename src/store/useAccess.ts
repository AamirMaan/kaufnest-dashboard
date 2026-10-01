"use client";

import { useAppSelector } from "./hooks";
import {
  can as canAccess,
  canSeeSection,
  applyPlanCeiling,
  ROLE_DEFAULTS,
  type AccessLevel,
  type AccessMap,
  type Section,
} from "@/lib/permissions/sections";

/**
 * Current user's section access. `state.currentUser.access` (from
 * `get_my_access()`, hydrated by `dashboard/layout.tsx`) is UNCAPPED by
 * plan — this hook applies the plan ceiling itself for `access`/`can()`
 * (button-level gating: a plan-gated section like Integrations reads as 0
 * until the tenant upgrades), while `canSee()` stays uncapped (nav/route
 * visibility: a role/exception grant to a plan-gated section still shows
 * the Sidebar link and lets the page render its own upgrade screen instead
 * of hiding the link entirely). Before hydration both fall back to plain
 * role defaults (`ROLE_DEFAULTS` — per-user exceptions aren't known yet
 * either way, and role defaults are themselves uncapped, unlike
 * `effectiveAccess()` which always applies the ceiling internally).
 */
export function useAccess(): {
  access: AccessMap;
  can: (s: Section, min: AccessLevel) => boolean;
  canSee: (s: Section) => boolean;
  level: (s: Section) => AccessLevel;
} {
  const stored = useAppSelector((s) => s.currentUser.access);
  const role = useAppSelector((s) => s.currentUser.profile?.role) ?? "accountant";
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const uncapped = stored ?? ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.accountant;
  const access = applyPlanCeiling(uncapped, plan);
  return {
    access,
    can: (s, min) => canAccess(access, s, min),
    canSee: (s) => canSeeSection(uncapped, s),
    level: (s) => access[s],
  };
}
