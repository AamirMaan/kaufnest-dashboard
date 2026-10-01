import { exceptionsToGrid, diffAccess, customSections, withLevel, needsIntegrations } from "./accessDiff";
import { ROLE_DEFAULTS, type AccessMap } from "@/lib/permissions/sections";

const D = ROLE_DEFAULTS.accountant;

describe("accessDiff", () => {
  it("overlays exception rows on role defaults", () => {
    expect(exceptionsToGrid("accountant", [{ section: "analytics", level: 0 }])).toEqual({
      ...D,
      analytics: 0,
    } as AccessMap);
  });

  it("upserts changed non-default cells, deletes cells set back to default, ignores unchanged", () => {
    const saved = { ...D, analytics: 0, purchases: 1 } as AccessMap;
    const edited = { ...D, analytics: 1, purchases: 1, payouts: 2 } as AccessMap;
    expect(diffAccess("accountant", saved, edited)).toEqual({
      upserts: [{ section: "payouts", level: 2 }],
      deletes: ["analytics"],
    });
  });

  it("reset to defaults deletes every custom section", () => {
    const saved = { ...D, analytics: 0, orders: 3 } as AccessMap;
    expect(diffAccess("accountant", saved, D)).toEqual({ upserts: [], deletes: ["analytics", "orders"] });
  });

  it("lists custom sections", () => {
    expect(customSections("accountant", { ...D, orders: 3 } as AccessMap)).toEqual(["orders"]);
    expect(customSections("accountant", D)).toEqual([]);
  });

  it("withLevel: lowering Integrations below Edit zeroes Listings/Messages", () => {
    const admin = { ...ROLE_DEFAULTS.admin };
    expect(withLevel(admin, "integrations", 0)).toMatchObject({ integrations: 0, listings: 0, messages: 0, orders: 3 });
    expect(withLevel(admin, "orders", 1)).toMatchObject({ orders: 1, listings: 2, messages: 2 });
    const acc = { ...ROLE_DEFAULTS.accountant, integrations: 2 as const };
    expect(withLevel(acc, "listings", 2)).toMatchObject({ integrations: 2, listings: 2 });
    expect(admin.integrations).toBe(2); // pure
  });

  it("needsIntegrations: Listings/Messages Edit is locked below Integrations: Edit", () => {
    const acc = { ...ROLE_DEFAULTS.accountant };
    expect(needsIntegrations(acc, "listings", 2)).toBe(true);
    expect(needsIntegrations(acc, "messages", 2)).toBe(true);
    expect(needsIntegrations(acc, "listings", 0)).toBe(false);
    expect(needsIntegrations(acc, "orders", 2)).toBe(false);
    expect(needsIntegrations({ ...acc, integrations: 2 }, "listings", 2)).toBe(false);
  });
});
