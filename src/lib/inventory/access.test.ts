import { canEnableAdvancedInventory } from "./access";

describe("canEnableAdvancedInventory", () => {
  it("allows admins and super admins on business and trial", () => {
    expect(canEnableAdvancedInventory("business", "admin")).toBe(true);
    expect(canEnableAdvancedInventory("business", "super_admin")).toBe(true);
    expect(canEnableAdvancedInventory("trial", "admin")).toBe(true);
  });

  it("refuses accountants and unknown roles", () => {
    expect(canEnableAdvancedInventory("business", "accountant")).toBe(false);
    expect(canEnableAdvancedInventory("business", null)).toBe(false);
    expect(canEnableAdvancedInventory("business", undefined)).toBe(false);
  });

  it("refuses starter and pro even for admins", () => {
    expect(canEnableAdvancedInventory("starter", "admin")).toBe(false);
    expect(canEnableAdvancedInventory("pro", "super_admin")).toBe(false);
  });
});
