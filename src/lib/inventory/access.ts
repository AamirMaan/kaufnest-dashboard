import type { UserRole } from "@/types";
import { hasAdvancedInventory, type PlanEntitlements } from "@/lib/plans/entitlements";

/**
 * Who may switch on batches & locations: an admin/super_admin on a plan
 * that includes advanced inventory. Pure so the rule is unit-tested; the
 * route guard (authGuard.ts) is the enforcement point.
 */
export function canEnableAdvancedInventory(ent: PlanEntitlements, role: UserRole | null | undefined): boolean {
  return hasAdvancedInventory(ent) && (role === "admin" || role === "super_admin");
}
