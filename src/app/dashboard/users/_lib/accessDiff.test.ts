import { exceptionsToGrid, diffAccess, customSections } from "./accessDiff";
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
});
