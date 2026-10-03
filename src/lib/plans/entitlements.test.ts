import {
  NO_ENTITLEMENTS,
  availabilityLine,
  canAddUser,
  canPurchase,
  entitlementsOf,
  formatPlanList,
  getAiGenerationLimit,
  hasAdvancedInventory,
  hasAiFeatures,
  hasMessagingAndListings,
  hasPlatformIntegrations,
  isAssignablePlan,
  planFromRow,
  planNamesByFeature,
  plansWithFeature,
  sortPlans,
  type Plan,
  type PlanRow,
} from "./entitlements";

const plan = (over: Partial<Plan> = {}): Plan => ({
  key: "pro",
  kind: "paid",
  name: "Pro",
  tagline: "",
  visibility: "public",
  monthlyEur: 30,
  stripeProductId: "prod_1",
  stripePriceId: "price_1",
  maxUsers: 5,
  platformIntegrations: true,
  aiFeatures: false,
  aiGenerationsPerMonth: 0,
  messagingAndListings: false,
  advancedInventory: false,
  trialDays: null,
  sortOrder: 2,
  highlighted: false,
  ...over,
});

describe("planFromRow", () => {
  it("maps snake_case columns and coerces numeric strings", () => {
    const row: PlanRow = {
      key: "pro", kind: "paid", name: "Pro", tagline: "t", visibility: "public",
      monthly_eur: "30.00" as unknown as number, stripe_product_id: "prod_1", stripe_price_id: "price_1",
      max_users: 5, platform_integrations: true, ai_features: false, ai_generations_per_month: 0,
      messaging_and_listings: false, advanced_inventory: false, trial_days: null,
      sort_order: 2, highlighted: true,
    };
    expect(planFromRow(row)).toEqual(plan({ tagline: "t", highlighted: true }));
  });
});

describe("entitlementsOf", () => {
  it("fails closed for null", () => {
    expect(entitlementsOf(null)).toEqual(NO_ENTITLEMENTS);
    expect(NO_ENTITLEMENTS).toEqual({
      maxUsers: 1, platformIntegrations: false, aiFeatures: false,
      aiGenerationsPerMonth: 0, messagingAndListings: false, advancedInventory: false,
    });
  });
  it("maps null max_users to Infinity", () => {
    expect(entitlementsOf(plan({ maxUsers: null })).maxUsers).toBe(Infinity);
  });
  it("forces AI quota to 0 when AI is off", () => {
    expect(entitlementsOf(plan({ aiFeatures: false, aiGenerationsPerMonth: 50 })).aiGenerationsPerMonth).toBe(0);
  });
});

describe("helpers", () => {
  const ent = entitlementsOf(plan({ maxUsers: 3, aiFeatures: true, aiGenerationsPerMonth: 300 }));
  it("canAddUser is strict less-than", () => {
    expect(canAddUser(ent, 2)).toBe(true);
    expect(canAddUser(ent, 3)).toBe(false);
    expect(canAddUser(entitlementsOf(plan({ maxUsers: null })), 10_000)).toBe(true);
  });
  it("feature flags", () => {
    expect(hasPlatformIntegrations(ent)).toBe(true);
    expect(hasAiFeatures(ent)).toBe(true);
    expect(getAiGenerationLimit(ent)).toBe(300);
    expect(hasMessagingAndListings(ent)).toBe(false);
    expect(hasAdvancedInventory(ent)).toBe(false);
  });
});

describe("plansWithFeature / formatPlanList / availabilityLine", () => {
  const catalog = [
    plan({ key: "business", name: "Business", sortOrder: 3, messagingAndListings: true }),
    plan({ key: "pro", name: "Pro", sortOrder: 2 }),
    plan({ key: "starter", name: "Starter", sortOrder: 1, platformIntegrations: false }),
    plan({ key: "secret", name: "Secret", visibility: "hidden", sortOrder: 4 }),
    plan({ key: "old", name: "Old", visibility: "retired", sortOrder: 5 }),
    plan({ key: "trial", kind: "trial", name: "Trial", visibility: "hidden", sortOrder: 0, monthlyEur: null }),
  ];
  it("lists only public paid plans, in sort order", () => {
    expect(plansWithFeature(catalog, "platformIntegrations")).toEqual(["Pro", "Business"]);
    expect(plansWithFeature(catalog, "messagingAndListings")).toEqual(["Business"]);
    expect(plansWithFeature(catalog, "advancedInventory")).toEqual([]);
  });
  it("planNamesByFeature covers every feature", () => {
    expect(planNamesByFeature(catalog)).toEqual({
      platformIntegrations: ["Pro", "Business"],
      aiFeatures: [],
      messagingAndListings: ["Business"],
      advancedInventory: [],
    });
  });
  it("formatPlanList", () => {
    expect(formatPlanList([])).toBeNull();
    expect(formatPlanList(["Business"])).toBe("the Business plan");
    expect(formatPlanList(["Pro", "Business"])).toBe("the Pro and Business plans");
    expect(formatPlanList(["A", "B", "C"])).toBe("the A, B and C plans");
  });
  it("availabilityLine", () => {
    expect(availabilityLine("eBay messaging", ["Business"])).toBe("eBay messaging is available on the Business plan.");
    expect(availabilityLine("eBay messaging", [])).toBe("Contact us to unlock this feature.");
  });
  it("sortPlans orders by sortOrder then key", () => {
    expect(sortPlans([plan({ key: "b", sortOrder: 1 }), plan({ key: "a", sortOrder: 1 }), plan({ key: "z", sortOrder: 0 })]).map((p) => p.key))
      .toEqual(["z", "a", "b"]);
  });
});

describe("canPurchase", () => {
  it("public with a price: yes", () => expect(canPurchase(plan(), "trial")).toBe(true));
  it("no Stripe price: no", () => expect(canPurchase(plan({ stripePriceId: null }), "trial")).toBe(false));
  it("trial: never", () => expect(canPurchase(plan({ key: "trial", kind: "trial", visibility: "hidden" }), "trial")).toBe(false));
  it("hidden: only the tenant's own plan", () => {
    const hidden = plan({ key: "deal", visibility: "hidden" });
    expect(canPurchase(hidden, "deal")).toBe(true);
    expect(canPurchase(hidden, "pro")).toBe(false);
  });
  it("retired: never", () => expect(canPurchase(plan({ visibility: "retired" }), "pro")).toBe(false));
});

describe("isAssignablePlan", () => {
  it("null plan: no", () => expect(isAssignablePlan(null, "pro")).toBe(false));
  it("retired: only when unchanged", () => {
    const old = plan({ key: "old", visibility: "retired" });
    expect(isAssignablePlan(old, "old")).toBe(true);
    expect(isAssignablePlan(old, "pro")).toBe(false);
  });
  it("hidden, public and trial are assignable", () => {
    expect(isAssignablePlan(plan({ visibility: "hidden" }), null)).toBe(true);
    expect(isAssignablePlan(plan(), null)).toBe(true);
    expect(isAssignablePlan(plan({ key: "trial", kind: "trial", visibility: "hidden" }), null)).toBe(true);
  });
});
