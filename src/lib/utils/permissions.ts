import type { UserRole } from "@/types";

// ─── Permission Matrix ────────────────────────────────────────────────────────

const PERMISSIONS = {
  // Record management
  create_expense: ["super_admin", "admin", "accountant"],
  update_expense: ["super_admin", "admin", "accountant"],
  delete_expense: ["super_admin", "admin"],
  create_purchase: ["super_admin", "admin", "accountant"],
  update_purchase: ["super_admin", "admin", "accountant"],
  delete_purchase: ["super_admin", "admin"],
  create_sale: ["super_admin", "admin", "accountant"],
  update_sale: ["super_admin", "admin", "accountant"],
  delete_sale: ["super_admin", "admin"],
  // User management
  manage_users: ["super_admin"],
  invite_user: ["super_admin"],
  change_user_role: ["super_admin"],
  // Audit logs
  view_audit_logs: ["super_admin", "admin"],
  // Analytics
  view_analytics: ["super_admin", "admin"],
  // Platform integrations (OAuth connections hold tokens)
  manage_integrations: ["super_admin", "admin"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Check if a role has the given permission.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly string[];
  return allowed.includes(role);
}

/**
 * Check if a role can access a given dashboard route path.
 */
export function canAccessRoute(role: UserRole, pathname: string): boolean {
  if (pathname.startsWith("/dashboard/users")) {
    return hasPermission(role, "manage_users");
  }
  if (pathname.startsWith("/dashboard/audit-logs")) {
    return hasPermission(role, "view_audit_logs");
  }
  return true; // all authenticated roles can access other routes
}

/**
 * Sorted role hierarchy — higher index = more permissions.
 */
const ROLE_HIERARCHY: UserRole[] = ["accountant", "admin", "super_admin"];

/**
 * Returns true if `role` is at least as privileged as `minimum`.
 */
export function hasMinimumRole(role: UserRole, minimum: UserRole): boolean {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(minimum);
}
