import {
  hasPermission,
  canAccessRoute,
  hasMinimumRole,
} from "./permissions";
import type { UserRole } from "@/types";

describe("hasPermission", () => {
  it("allows super_admin to delete expenses", () => {
    expect(hasPermission("super_admin", "delete_expense")).toBe(true);
  });

  it("allows admin to delete expenses", () => {
    expect(hasPermission("admin", "delete_expense")).toBe(true);
  });

  it("denies accountant from deleting expenses", () => {
    expect(hasPermission("accountant", "delete_expense")).toBe(false);
  });

  it("allows all roles to create expenses", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(hasPermission(role, "create_expense")).toBe(true);
    });
  });

  it("restricts manage_users to super_admin only", () => {
    expect(hasPermission("super_admin", "manage_users")).toBe(true);
    expect(hasPermission("admin", "manage_users")).toBe(false);
    expect(hasPermission("accountant", "manage_users")).toBe(false);
  });

  it("restricts invite_user to super_admin only", () => {
    expect(hasPermission("super_admin", "invite_user")).toBe(true);
    expect(hasPermission("admin", "invite_user")).toBe(false);
    expect(hasPermission("accountant", "invite_user")).toBe(false);
  });

  it("restricts change_user_role to super_admin only", () => {
    expect(hasPermission("super_admin", "change_user_role")).toBe(true);
    expect(hasPermission("admin", "change_user_role")).toBe(false);
    expect(hasPermission("accountant", "change_user_role")).toBe(false);
  });

  it("allows admin and super_admin to view audit logs", () => {
    expect(hasPermission("super_admin", "view_audit_logs")).toBe(true);
    expect(hasPermission("admin", "view_audit_logs")).toBe(true);
    expect(hasPermission("accountant", "view_audit_logs")).toBe(false);
  });

  it("allows admin and super_admin to view analytics", () => {
    expect(hasPermission("super_admin", "view_analytics")).toBe(true);
    expect(hasPermission("admin", "view_analytics")).toBe(true);
    expect(hasPermission("accountant", "view_analytics")).toBe(false);
  });

  it("restricts manage_listings to admin and super_admin", () => {
    expect(hasPermission("super_admin", "manage_listings")).toBe(true);
    expect(hasPermission("admin", "manage_listings")).toBe(true);
    expect(hasPermission("accountant", "manage_listings")).toBe(false);
  });

  it("allows all roles to create and update sales", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(hasPermission(role, "create_sale")).toBe(true);
      expect(hasPermission(role, "update_sale")).toBe(true);
    });
  });

  it("denies accountant from deleting sales and purchases", () => {
    expect(hasPermission("accountant", "delete_sale")).toBe(false);
    expect(hasPermission("accountant", "delete_purchase")).toBe(false);
  });

  it("allows admin and super_admin to delete sales and purchases", () => {
    expect(hasPermission("admin", "delete_sale")).toBe(true);
    expect(hasPermission("super_admin", "delete_sale")).toBe(true);
    expect(hasPermission("admin", "delete_purchase")).toBe(true);
    expect(hasPermission("super_admin", "delete_purchase")).toBe(true);
  });

  it("grants a permission an accountant's role lacks when it's in the override list", () => {
    expect(hasPermission("accountant", "delete_sale")).toBe(false);
    expect(hasPermission("accountant", "delete_sale", ["delete_sale"])).toBe(true);
  });

  it("overrides are additive only — an unrelated override doesn't grant other permissions", () => {
    expect(hasPermission("accountant", "manage_users", ["delete_sale"])).toBe(false);
  });

  it("ignores a null/undefined overrides list (defaults to role-only check)", () => {
    expect(hasPermission("accountant", "delete_sale", null)).toBe(false);
    expect(hasPermission("accountant", "delete_sale", undefined)).toBe(false);
  });

  it("a role that already has the permission is unaffected by overrides", () => {
    expect(hasPermission("super_admin", "delete_sale", [])).toBe(true);
  });
});

describe("canAccessRoute", () => {
  it("denies accountant from /dashboard/users", () => {
    expect(canAccessRoute("accountant", "/dashboard/users")).toBe(false);
  });

  it("denies admin from /dashboard/users", () => {
    expect(canAccessRoute("admin", "/dashboard/users")).toBe(false);
  });

  it("allows super_admin to access /dashboard/users", () => {
    expect(canAccessRoute("super_admin", "/dashboard/users")).toBe(true);
  });

  it("denies accountant from /dashboard/audit-logs", () => {
    expect(canAccessRoute("accountant", "/dashboard/audit-logs")).toBe(false);
  });

  it("allows admin to access /dashboard/audit-logs", () => {
    expect(canAccessRoute("admin", "/dashboard/audit-logs")).toBe(true);
  });

  it("allows super_admin to access /dashboard/audit-logs", () => {
    expect(canAccessRoute("super_admin", "/dashboard/audit-logs")).toBe(true);
  });

  it("allows all roles to access /dashboard/expenses", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(canAccessRoute(role, "/dashboard/expenses")).toBe(true);
    });
  });

  it("allows all roles to access /dashboard/sales", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(canAccessRoute(role, "/dashboard/sales")).toBe(true);
    });
  });

  it("allows all roles to access /dashboard/purchases", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(canAccessRoute(role, "/dashboard/purchases")).toBe(true);
    });
  });

  it("allows all roles to access the base dashboard", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(canAccessRoute(role, "/dashboard")).toBe(true);
    });
  });

  it("allows access via an override even when the role alone would be denied", () => {
    expect(canAccessRoute("accountant", "/dashboard/users", ["manage_users"])).toBe(true);
    expect(canAccessRoute("accountant", "/dashboard/audit-logs", ["view_audit_logs"])).toBe(true);
  });
});

describe("hasMinimumRole", () => {
  it("super_admin satisfies minimum of accountant", () => {
    expect(hasMinimumRole("super_admin", "accountant")).toBe(true);
  });

  it("super_admin satisfies minimum of super_admin", () => {
    expect(hasMinimumRole("super_admin", "super_admin")).toBe(true);
  });

  it("accountant does not satisfy minimum of admin", () => {
    expect(hasMinimumRole("accountant", "admin")).toBe(false);
  });

  it("admin satisfies minimum of admin", () => {
    expect(hasMinimumRole("admin", "admin")).toBe(true);
  });

  it("admin does not satisfy minimum of super_admin", () => {
    expect(hasMinimumRole("admin", "super_admin")).toBe(false);
  });

  it("accountant satisfies minimum of accountant", () => {
    expect(hasMinimumRole("accountant", "accountant")).toBe(true);
  });

  it("admin satisfies minimum of accountant", () => {
    expect(hasMinimumRole("admin", "accountant")).toBe(true);
  });
});
