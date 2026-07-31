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
  // eBay listing creation/publishing
  manage_listings: ["super_admin", "admin"],
  // eBay buyer message sync/reply
  manage_messages: ["super_admin", "admin"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Every permission key, for enumerating a full permission checklist (e.g. the Permissions modal). */
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Human-readable label for each permission, grouped for display. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  create_expense: "Create expenses",
  update_expense: "Edit expenses",
  delete_expense: "Delete expenses",
  create_purchase: "Create purchases",
  update_purchase: "Edit purchases",
  delete_purchase: "Delete purchases",
  create_sale: "Create orders",
  update_sale: "Edit orders",
  delete_sale: "Delete orders",
  manage_users: "Manage users (invite, edit, change roles)",
  invite_user: "Invite new users",
  change_user_role: "Change user roles",
  view_audit_logs: "View audit logs",
  view_analytics: "View analytics",
  manage_integrations: "Manage platform integrations (eBay/Amazon)",
  manage_listings: "Create and publish eBay listings",
  manage_messages: "Reply to and manage eBay messages",
};

/**
 * Check if a role — plus any additive per-user permission overrides — grants
 * the given permission. `overrides` (from `Profile.permission_overrides`) can
 * only ADD permissions on top of the role's defaults, never take one away.
 */
export function hasPermission(
  role: UserRole,
  permission: Permission,
  overrides: readonly string[] | null | undefined = []
): boolean {
  const allowed = PERMISSIONS[permission] as readonly string[];
  return allowed.includes(role) || (overrides?.includes(permission) ?? false);
}

/**
 * Check if a role — plus any overrides — can access a given dashboard route path.
 */
export function canAccessRoute(
  role: UserRole,
  pathname: string,
  overrides: readonly string[] | null | undefined = []
): boolean {
  if (pathname.startsWith("/dashboard/users")) {
    return hasPermission(role, "manage_users", overrides);
  }
  if (pathname.startsWith("/dashboard/audit-logs")) {
    return hasPermission(role, "view_audit_logs", overrides);
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
