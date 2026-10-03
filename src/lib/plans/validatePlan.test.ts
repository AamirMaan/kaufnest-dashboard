import type { Plan } from "./entitlements";
import {
  detectReductions,
  parsePlanInput,
  planDiff,
  planInputToRow,
  validatePlan,
  type PlanInput,
} from "./validatePlan";

const basePlan = (overrides: Partial<Plan> = {}): Plan => ({
  key: "pro",
  kind: "paid",
  name: "Pro",
  tagline: "",
  visibility: "public",
  monthlyEur: 30,
  stripeProductId: "prod_p",
  stripePriceId: "price_p",
  maxUsers: 5,
  platformIntegrations: true,
  aiFeatures: false,
  aiGenerationsPerMonth: 0,
  messagingAndListings: false,
  advancedInventory: false,
  trialDays: null,
  sortOrder: 2,
  highlighted: true,
  ...overrides,
});

const baseInput = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  key: "pro",
  kind: "paid",
  name: "Pro",
  tagline: "",
  visibility: "public",
  monthlyEur: 30,
  maxUsers: 5,
  platformIntegrations: true,
  aiFeatures: false,
  aiGenerationsPerMonth: 0,
  messagingAndListings: false,
  advancedInventory: false,
  trialDays: null,
  sortOrder: 2,
  highlighted: true,
  ...overrides,
});

describe("parsePlanInput", () => {
  it("returns null for non-objects", () => {
    expect(parsePlanInput(null)).toBeNull();
    expect(parsePlanInput(undefined)).toBeNull();
    expect(parsePlanInput("nope")).toBeNull();
    expect(parsePlanInput(42)).toBeNull();
  });

  it("coerces numeric strings", () => {
    expect(parsePlanInput({ monthlyEur: "30" })?.monthlyEur).toBe(30);
  });

  it("maps empty string / null maxUsers to null", () => {
    expect(parsePlanInput({ maxUsers: "" })?.maxUsers).toBeNull();
    expect(parsePlanInput({ maxUsers: null })?.maxUsers).toBeNull();
  });

  it("defaults booleans to false", () => {
    const input = parsePlanInput({});
    expect(input?.platformIntegrations).toBe(false);
    expect(input?.aiFeatures).toBe(false);
    expect(input?.messagingAndListings).toBe(false);
    expect(input?.advancedInventory).toBe(false);
    expect(input?.highlighted).toBe(false);
  });

  it("defaults tagline to an empty string", () => {
    expect(parsePlanInput({})?.tagline).toBe("");
  });

  it("trims name", () => {
    expect(parsePlanInput({ name: "  Pro  " })?.name).toBe("Pro");
  });
});

describe("validatePlan - key", () => {
  it("rejects invalid key formats", () => {
    for (const key of ["Pro", "1pro", "p", "a".repeat(33)]) {
      const errors = validatePlan(baseInput({ key }), { isCreate: true, catalog: [] });
      expect(errors.key).toBeDefined();
    }
  });

  it("rejects a duplicate key on create", () => {
    const errors = validatePlan(baseInput({ key: "pro" }), { isCreate: true, catalog: [basePlan({ key: "pro" })] });
    expect(errors.key).toBe("A plan with this key already exists.");
  });

  it("rejects \"trial\" as a paid plan's key", () => {
    const errors = validatePlan(baseInput({ key: "trial", kind: "paid" }), { isCreate: true, catalog: [] });
    expect(errors.key).toBe("\"trial\" is reserved for the free trial.");
  });

  it("does not check for duplicate keys on edit", () => {
    const errors = validatePlan(baseInput({ key: "pro" }), { isCreate: false, catalog: [basePlan({ key: "pro" })] });
    expect(errors.key).toBeUndefined();
  });
});

it("rejects creating a non-paid plan", () => {
  const errors = validatePlan(
    baseInput({ kind: "trial", key: "trial", visibility: "hidden", trialDays: 30, monthlyEur: null }),
    { isCreate: true, catalog: [] }
  );
  expect(errors.kind).toBe("Only paid plans can be created.");
});

it("requires a name", () => {
  const errors = validatePlan(baseInput({ name: "" }), { isCreate: true, catalog: [] });
  expect(errors.name).toBe("Name is required.");
});

describe("validatePlan - monthlyEur (paid)", () => {
  it.each([null, 0, 0.5])("rejects an out-of-range price %p", (val) => {
    const errors = validatePlan(baseInput({ monthlyEur: val as number | null }), { isCreate: false, catalog: [] });
    expect(errors.monthlyEur).toBeDefined();
  });

  it("rejects more than two decimals", () => {
    const errors = validatePlan(baseInput({ monthlyEur: 19.999 }), { isCreate: false, catalog: [] });
    expect(errors.monthlyEur).toBe("Use at most two decimals.");
  });

  it("rejects an amount over the cap", () => {
    const errors = validatePlan(baseInput({ monthlyEur: 100001 }), { isCreate: false, catalog: [] });
    expect(errors.monthlyEur).toBeDefined();
  });

  it("accepts a valid price", () => {
    const errors = validatePlan(baseInput({ monthlyEur: 19.99 }), { isCreate: false, catalog: [] });
    expect(errors.monthlyEur).toBeUndefined();
  });
});

describe("validatePlan - maxUsers", () => {
  it("rejects zero", () => {
    expect(validatePlan(baseInput({ maxUsers: 0 }), { isCreate: false, catalog: [] }).maxUsers).toBeDefined();
  });
  it("allows null (unlimited)", () => {
    expect(validatePlan(baseInput({ maxUsers: null }), { isCreate: false, catalog: [] }).maxUsers).toBeUndefined();
  });
  it("rejects non-integers", () => {
    expect(validatePlan(baseInput({ maxUsers: 1.5 }), { isCreate: false, catalog: [] }).maxUsers).toBeDefined();
  });
});

describe("validatePlan - AI quota", () => {
  it("rejects a quota when aiFeatures is off", () => {
    const errors = validatePlan(baseInput({ aiFeatures: false, aiGenerationsPerMonth: 10 }), { isCreate: false, catalog: [] });
    expect(errors.aiGenerationsPerMonth).toBe("Turn on AI features to give an AI allowance.");
  });
  it("rejects a negative quota", () => {
    const errors = validatePlan(baseInput({ aiFeatures: true, aiGenerationsPerMonth: -1 }), { isCreate: false, catalog: [] });
    expect(errors.aiGenerationsPerMonth).toBeDefined();
  });
  it("rejects a non-integer quota", () => {
    const errors = validatePlan(baseInput({ aiFeatures: true, aiGenerationsPerMonth: 1.5 }), { isCreate: false, catalog: [] });
    expect(errors.aiGenerationsPerMonth).toBeDefined();
  });
});

describe("validatePlan - trial", () => {
  const trialInput = (overrides: Partial<PlanInput> = {}) =>
    baseInput({ kind: "trial", key: "trial", visibility: "hidden", trialDays: 30, monthlyEur: null, ...overrides });

  it.each([0, 91, null])("rejects an out-of-range trialDays %p", (days) => {
    const errors = validatePlan(trialInput({ trialDays: days as number | null }), { isCreate: false, catalog: [] });
    expect(errors.trialDays).toBeDefined();
  });

  it("accepts 30 trial days", () => {
    expect(validatePlan(trialInput(), { isCreate: false, catalog: [] }).trialDays).toBeUndefined();
  });

  it("rejects a public trial", () => {
    const errors = validatePlan(trialInput({ visibility: "public" }), { isCreate: false, catalog: [] });
    expect(errors.visibility).toBe("The trial is always hidden.");
  });
});

describe("validatePlan - last public plan", () => {
  const proPublic = basePlan({ key: "pro", kind: "paid", visibility: "public" });

  it.each(["hidden", "retired"] as const)("blocks hiding the only public plan (%s)", (visibility) => {
    const errors = validatePlan(baseInput({ key: "pro", visibility }), { isCreate: false, catalog: [proPublic] });
    expect(errors.visibility).toBe("Keep at least one public plan.");
  });

  it("allows creating a new hidden plan", () => {
    const errors = validatePlan(baseInput({ key: "enterprise", visibility: "hidden" }), {
      isCreate: true,
      catalog: [proPublic],
    });
    expect(errors.visibility).toBeUndefined();
  });

  it("allows hiding pro when a second public plan exists", () => {
    const business = basePlan({ key: "business", visibility: "public" });
    const errors = validatePlan(baseInput({ key: "pro", visibility: "hidden" }), {
      isCreate: false,
      catalog: [proPublic, business],
    });
    expect(errors.visibility).toBeUndefined();
  });
});

it("rejects a non-integer sortOrder", () => {
  expect(validatePlan(baseInput({ sortOrder: 1.5 }), { isCreate: false, catalog: [] }).sortOrder).toBeDefined();
});

describe("detectReductions", () => {
  const makeBefore = (overrides: Partial<Plan> = {}) => basePlan({ maxUsers: 5, ...overrides });

  it("flags a max users decrease", () => {
    expect(detectReductions(makeBefore({ maxUsers: 5 }), baseInput({ maxUsers: 3 }))).toEqual(["Max users: 5 → 3"]);
  });

  it("flags unlimited → a number", () => {
    expect(detectReductions(makeBefore({ maxUsers: null }), baseInput({ maxUsers: 10 }))).toEqual([
      "Max users: Unlimited → 10",
    ]);
  });

  it("does not flag a number → unlimited", () => {
    expect(detectReductions(makeBefore({ maxUsers: 3 }), baseInput({ maxUsers: null }))).toEqual([]);
  });

  it.each([
    ["platformIntegrations", "Platform integrations"],
    ["aiFeatures", "AI features"],
    ["messagingAndListings", "Listings & messages"],
    ["advancedInventory", "Advanced inventory"],
  ] as const)("flags turning off %s", (field, label) => {
    const before = makeBefore({ [field]: true } as Partial<Plan>);
    const after = baseInput({ [field]: false } as Partial<PlanInput>);
    expect(detectReductions(before, after)).toContain(`Removes ${label}`);
  });

  it("flags an AI quota decrease", () => {
    const before = makeBefore({ aiGenerationsPerMonth: 300 });
    const after = baseInput({ aiFeatures: true, aiGenerationsPerMonth: 100 });
    expect(detectReductions(before, after)).toContain("AI generations / month: 300 → 100");
  });

  it("does not flag increases", () => {
    const before = makeBefore({ maxUsers: 3, aiGenerationsPerMonth: 100 });
    const after = baseInput({ maxUsers: 5, aiFeatures: true, aiGenerationsPerMonth: 300 });
    expect(detectReductions(before, after)).toEqual([]);
  });
});

describe("planDiff", () => {
  it("only includes changed fields", () => {
    const diff = planDiff(basePlan(), baseInput({ name: "Pro Plus" }));
    expect(Object.keys(diff)).toEqual(["name"]);
    expect(diff.name).toEqual({ from: "Pro", to: "Pro Plus" });
  });

  it("lists every field with from: null when before is null, including fields whose input value is itself null", () => {
    const diff = planDiff(null, baseInput());
    expect(Object.values(diff).every((d) => d.from === null)).toBe(true);
    expect(diff.key).toEqual({ from: null, to: "pro" });
    expect(diff.name).toEqual({ from: null, to: "Pro" });
    expect(diff.monthlyEur).toEqual({ from: null, to: 30 });
    // trialDays is null on this (paid-plan) input, but must still appear —
    // an audit record for a create should never silently drop a field.
    expect(diff.trialDays).toEqual({ from: null, to: null });
    expect(Object.keys(diff).sort()).toEqual(
      [
        "key", "kind", "name", "tagline", "visibility", "monthlyEur", "maxUsers",
        "platformIntegrations", "aiFeatures", "aiGenerationsPerMonth", "messagingAndListings",
        "advancedInventory", "trialDays", "sortOrder", "highlighted",
      ].sort()
    );
  });
});

describe("planInputToRow", () => {
  it("maps every field to its snake_case column, omitting stripe ids", () => {
    const row = planInputToRow(baseInput());
    expect(row).toEqual({
      key: "pro",
      kind: "paid",
      name: "Pro",
      tagline: "",
      visibility: "public",
      monthly_eur: 30,
      max_users: 5,
      platform_integrations: true,
      ai_features: false,
      ai_generations_per_month: 0,
      messaging_and_listings: false,
      advanced_inventory: false,
      trial_days: null,
      sort_order: 2,
      highlighted: true,
    });
    expect(row).not.toHaveProperty("stripeProductId");
    expect(row).not.toHaveProperty("stripe_product_id");
    expect(row).not.toHaveProperty("stripePriceId");
    expect(row).not.toHaveProperty("stripe_price_id");
  });

  it("nulls monthly_eur for a trial plan and trial_days for a paid plan", () => {
    const trialRow = planInputToRow(baseInput({ kind: "trial", monthlyEur: null, trialDays: 30 }));
    expect(trialRow.monthly_eur).toBeNull();
    expect(trialRow.trial_days).toBe(30);

    const paidRow = planInputToRow(baseInput());
    expect(paidRow.trial_days).toBeNull();
  });
});
