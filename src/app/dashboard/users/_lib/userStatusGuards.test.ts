import { canDeactivateUser } from "./userStatusGuards";

const superAdmin1 = { id: "u1", role: "super_admin" as const, status: "active" as const };
const superAdmin2 = { id: "u2", role: "super_admin" as const, status: "active" as const };
const admin = { id: "u3", role: "admin" as const, status: "active" as const };
const accountant = { id: "u4", role: "accountant" as const, status: "active" as const };
const deactivatedAccountant = { id: "u5", role: "accountant" as const, status: "deactivated" as const };

describe("canDeactivateUser", () => {
  it("allows deactivating a regular active accountant", () => {
    const result = canDeactivateUser(accountant, superAdmin1.id, [superAdmin1, accountant]);
    expect(result.allowed).toBe(true);
  });

  it("allows deactivating an admin", () => {
    const result = canDeactivateUser(admin, superAdmin1.id, [superAdmin1, admin]);
    expect(result.allowed).toBe(true);
  });

  it("blocks deactivating an already-deactivated user", () => {
    const result = canDeactivateUser(deactivatedAccountant, superAdmin1.id, [
      superAdmin1,
      deactivatedAccountant,
    ]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/already deactivated/);
  });

  it("blocks a super_admin from deactivating themselves", () => {
    const result = canDeactivateUser(superAdmin1, superAdmin1.id, [superAdmin1, admin]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/own account/);
  });

  it("blocks deactivating the last remaining active super_admin", () => {
    const result = canDeactivateUser(superAdmin1, superAdmin2.id, [superAdmin1, accountant]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/at least one active super admin/i);
  });

  it("allows deactivating a super_admin when another active super_admin remains", () => {
    const result = canDeactivateUser(superAdmin1, superAdmin2.id, [superAdmin1, superAdmin2]);
    expect(result.allowed).toBe(true);
  });

  it("allows deactivating a super_admin who is already the target when other active super_admins exist, even if some are deactivated", () => {
    const deactivatedSuperAdmin = { id: "u6", role: "super_admin" as const, status: "deactivated" as const };
    const result = canDeactivateUser(superAdmin1, superAdmin2.id, [
      superAdmin1,
      superAdmin2,
      deactivatedSuperAdmin,
    ]);
    expect(result.allowed).toBe(true);
  });
});
