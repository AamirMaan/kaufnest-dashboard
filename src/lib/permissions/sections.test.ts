import {
  SECTIONS, SECTION_KEYS, ROLE_DEFAULTS, maxLevel, planAllows, applyPlanCeiling,
  effectiveAccess, parseAccessMap, sectionForPath, can, firstAccessiblePath, deniedRedirect, type AccessMap,
} from "./sections";

const NONE: AccessMap = Object.fromEntries(SECTION_KEYS.map((k) => [k, 0])) as AccessMap;

describe("sections model", () => {
  it("has the 12 sections in grid order", () => {
    expect(SECTION_KEYS).toEqual([
      "overview", "analytics", "orders", "expenses", "purchases", "inventory",
      "payouts", "integrations", "listings", "messages", "audit_logs", "settings",
    ]);
    expect(SECTIONS.map((s) => s.key)).toEqual(SECTION_KEYS);
  });

  it("allowed levels per section", () => {
    const levels = Object.fromEntries(SECTIONS.map((s) => [s.key, s.levels]));
    expect(levels.overview).toEqual([0, 1]);
    expect(levels.audit_logs).toEqual([0, 1]);
    expect(levels.integrations).toEqual([0, 2]);
    expect(levels.settings).toEqual([0, 1, 2]);
    expect(levels.orders).toEqual([0, 1, 2, 3]);
    expect(maxLevel("listings")).toBe(2);
    expect(maxLevel("payouts")).toBe(3);
  });

  it("role defaults reproduce today's access", () => {
    expect(ROLE_DEFAULTS.accountant).toEqual({
      overview: 1, analytics: 1, orders: 2, expenses: 2, purchases: 2, inventory: 2,
      payouts: 1, integrations: 0, listings: 0, messages: 0, audit_logs: 0, settings: 1,
    });
    for (const k of SECTION_KEYS) {
      expect(ROLE_DEFAULTS.admin[k]).toBe(maxLevel(k));
      expect(ROLE_DEFAULTS.super_admin[k]).toBe(maxLevel(k));
    }
  });

  it("plan ceiling", () => {
    expect(planAllows("integrations", "starter")).toBe(false);
    expect(planAllows("integrations", "pro")).toBe(true);
    expect(planAllows("listings", "pro")).toBe(false);
    expect(planAllows("messages", "business")).toBe(true);
    expect(planAllows("orders", null)).toBe(true);
    expect(applyPlanCeiling(ROLE_DEFAULTS.admin, "pro")).toMatchObject({ integrations: 2, listings: 0, messages: 0, orders: 3 });
  });

  it("effectiveAccess: exceptions win, super_admin locked to max, plan ceiling applied", () => {
    const a = effectiveAccess("accountant", { analytics: 0, purchases: 1, integrations: 2 }, "business");
    expect(a).toMatchObject({ analytics: 0, purchases: 1, integrations: 2, orders: 2 });
    expect(effectiveAccess("super_admin", { orders: 0 }, "business").orders).toBe(3);
    expect(effectiveAccess("accountant", { listings: 2 }, "pro").listings).toBe(0);
  });

  it("parseAccessMap validates and falls back per key", () => {
    expect(parseAccessMap({ ...ROLE_DEFAULTS.accountant, orders: 0 }, "accountant").orders).toBe(0);
    expect(parseAccessMap({ orders: 7, analytics: "x" }, "accountant")).toMatchObject({ orders: 2, analytics: 1 });
    expect(parseAccessMap(null, "admin")).toEqual(ROLE_DEFAULTS.admin);
  });

  it("maps paths to sections", () => {
    expect(sectionForPath("/dashboard")).toBe("overview");
    expect(sectionForPath("/dashboard/analytics")).toBe("analytics");
    expect(sectionForPath("/dashboard/sales/abc")).toBe("orders");
    expect(sectionForPath("/dashboard/integrations/review")).toBe("integrations");
    expect(sectionForPath("/dashboard/audit-logs")).toBe("audit_logs");
    expect(sectionForPath("/dashboard/users/1/permissions")).toBe("users");
    expect(sectionForPath("/dashboard/support")).toBeNull();
    expect(sectionForPath("/dashboard/planner")).toBeNull();
    expect(sectionForPath("/dashboard/dropshipping")).toBeNull();
  });

  it("can / firstAccessiblePath", () => {
    expect(can(ROLE_DEFAULTS.accountant, "orders", 3)).toBe(false);
    expect(can(ROLE_DEFAULTS.accountant, "orders", 2)).toBe(true);
    expect(firstAccessiblePath({ ...NONE, expenses: 1 })).toBe("/dashboard/expenses");
    expect(firstAccessiblePath(NONE)).toBe("/dashboard/support");
  });

  it("deniedRedirect: one hop to the first accessible page, carrying ?denied for a non-overview section", () => {
    // overview=0, orders=0, expenses=1 — Home hidden too, so fall through to the first accessible route.
    expect(deniedRedirect("/dashboard/sales", "orders", { ...NONE, expenses: 1 })).toBe("/dashboard/expenses?denied=orders");
  });

  it("deniedRedirect: Home visible — denied section bounces to /dashboard", () => {
    expect(deniedRedirect("/dashboard/sales", "orders", { ...NONE, overview: 1 })).toBe("/dashboard?denied=orders");
  });

  it("deniedRedirect: everything denied falls back to /dashboard/support", () => {
    expect(deniedRedirect("/dashboard/sales", "orders", NONE)).toBe("/dashboard/support?denied=orders");
  });

  it("deniedRedirect: overview itself denied is not an error — no denied param added", () => {
    expect(deniedRedirect("/dashboard", "overview", { ...NONE, expenses: 1 })).toBe("/dashboard/expenses");
  });

  it("deniedRedirect: overview denied preserves an incoming denied param", () => {
    expect(deniedRedirect("/dashboard", "overview", { ...NONE, expenses: 1 }, "orders")).toBe("/dashboard/expenses?denied=orders");
  });

  it("deniedRedirect: allowed section needs no redirect", () => {
    expect(deniedRedirect("/dashboard/sales", "orders", { ...NONE, orders: 1 })).toBeNull();
  });

  it("deniedRedirect: destination equal to current path needs no redirect (loop guard)", () => {
    expect(deniedRedirect("/dashboard/expenses", "orders", { ...NONE, expenses: 1 })).toBeNull();
  });
});
