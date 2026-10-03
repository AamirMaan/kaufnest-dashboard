import type { UserRole } from "@/types";

/**
 * Who may subscribe, change plan or cancel: an admin/super_admin who also
 * holds Settings: Edit (055 — billing lives in Settings). Pure and shared by
 * requireBillingAdmin() and GET /api/billing/status's `canManageBilling`, so
 * the routes and the UI can't disagree. Fails closed on missing inputs.
 */
export function canManageBilling(
  role: UserRole | null | undefined,
  settingsLevel: number | null | undefined
): boolean {
  return (role === "admin" || role === "super_admin") && typeof settingsLevel === "number" && settingsLevel >= 2;
}
