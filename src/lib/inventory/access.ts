import type { TenantPlan, UserRole } from "@/types";
import { hasAdvancedInventory } from "@/lib/utils/planGating";

/**
 * Who may switch on batches & locations: an admin/super_admin on a plan
 * that includes advanced inventory. Pure so the rule is unit-tested; the
 * route guard (authGuard.ts) is the enforcement point.
 */
export function canEnableAdvancedInventory(plan: TenantPlan, role: UserRole | null | undefined): boolean {
  return hasAdvancedInventory(plan) && (role === "admin" || role === "super_admin");
}
