import { canEnableAdvancedInventory } from "./access";
import { NO_ENTITLEMENTS, type PlanEntitlements } from "@/lib/plans/entitlements";

const ENT = (over: Partial<PlanEntitlements> = {}): PlanEntitlements => ({ ...NO_ENTITLEMENTS, ...over });
const STARTER = ENT({ maxUsers: 3 });
const PRO = ENT({ maxUsers: 5, platformIntegrations: true });
const ADVANCED = ENT({ maxUsers: Infinity, platformIntegrations: true, aiFeatures: true, aiGenerationsPerMonth: 300, messagingAndListings: true, advancedInventory: true });

describe("canEnableAdvancedInventory", () => {
  it("allows admins and super admins on a plan with advanced inventory", () => {
    expect(canEnableAdvancedInventory(ADVANCED, "admin")).toBe(true);
    expect(canEnableAdvancedInventory(ADVANCED, "super_admin")).toBe(true);
  });

  it("refuses accountants and unknown roles", () => {
    expect(canEnableAdvancedInventory(ADVANCED, "accountant")).toBe(false);
    expect(canEnableAdvancedInventory(ADVANCED, null)).toBe(false);
    expect(canEnableAdvancedInventory(ADVANCED, undefined)).toBe(false);
  });

  it("refuses plans without advanced inventory even for admins", () => {
    expect(canEnableAdvancedInventory(STARTER, "admin")).toBe(false);
    expect(canEnableAdvancedInventory(PRO, "super_admin")).toBe(false);
    expect(canEnableAdvancedInventory(NO_ENTITLEMENTS, "admin")).toBe(false);
  });
});
