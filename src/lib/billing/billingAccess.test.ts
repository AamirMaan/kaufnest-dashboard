import { canManageBilling } from "./billingAccess";

describe("canManageBilling", () => {
  it("needs admin/super_admin AND Settings: Edit", () => {
    expect(canManageBilling("admin", 2)).toBe(true);
    expect(canManageBilling("super_admin", 2)).toBe(true);
    expect(canManageBilling("admin", 1)).toBe(false);
    expect(canManageBilling("admin", 0)).toBe(false);
    expect(canManageBilling("accountant", 2)).toBe(false);
  });

  it("fails closed on a missing role or level", () => {
    expect(canManageBilling(undefined, 2)).toBe(false);
    expect(canManageBilling("admin", null)).toBe(false);
  });
});
