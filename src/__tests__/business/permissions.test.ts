import {
  hasPermission,
  canAccessRoute,
  hasMinimumRole,
} from "@/lib/utils/permissions";
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

  it("allows admin and super_admin to view audit logs", () => {
    expect(hasPermission("super_admin", "view_audit_logs")).toBe(true);
    expect(hasPermission("admin", "view_audit_logs")).toBe(true);
    expect(hasPermission("accountant", "view_audit_logs")).toBe(false);
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

  it("allows all roles to access /dashboard/expenses", () => {
    const roles: UserRole[] = ["super_admin", "admin", "accountant"];
    roles.forEach((role) => {
      expect(canAccessRoute(role, "/dashboard/expenses")).toBe(true);
    });
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
});
