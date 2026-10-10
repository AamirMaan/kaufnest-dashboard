import type { Plan } from "@/lib/plans/entitlements";
import { validatePlan } from "@/lib/plans/validatePlan";
import {
  emptyPlanInput,
  inputFromPlan,
  numberFieldValue,
  parseNumberField,
  parseOptionalNumberField,
  slugifyKey,
  visibilityBadge,
} from "./planFormState";

const pro: Plan = {
  key: "pro",
  kind: "paid",
  name: "Pro",
  tagline: "Pull your eBay and Amazon orders in automatically.",
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
  highlighted: true,
};

describe("slugifyKey", () => {
  it("lowercases and joins non-alphanumeric runs with _", () => {
    expect(slugifyKey("Enterprise Plus!")).toBe("enterprise_plus");
  });

  it("prefixes p_ when the result starts with a digit", () => {
    expect(slugifyKey("  2024 Deal ")).toBe("p_2024_deal");
  });

  it("cuts the key to 32 characters", () => {
    expect(slugifyKey("a".repeat(40)).length).toBe(32);
  });
});

describe("inputFromPlan", () => {
  it("copies every PlanInput field and drops the Stripe ids", () => {
    const input = inputFromPlan(pro);
    const expected: Record<string, unknown> = { ...pro };
    delete expected.stripeProductId;
    delete expected.stripePriceId;
    expect(input).toEqual(expected);
    expect(input).not.toHaveProperty("stripeProductId");
    expect(input).not.toHaveProperty("stripePriceId");
  });
});

describe("emptyPlanInput", () => {
  it("is a public paid plan with nothing unlocked", () => {
    expect(emptyPlanInput()).toEqual({
      key: "",
      kind: "paid",
      name: "",
      tagline: "",
      visibility: "public",
      monthlyEur: null,
      maxUsers: null,
      platformIntegrations: false,
      aiFeatures: false,
      aiGenerationsPerMonth: 0,
      messagingAndListings: false,
      advancedInventory: false,
      trialDays: null,
      sortOrder: 0,
      highlighted: false,
    });
  });

  it("only fails validation on key, name and price", () => {
    const errors = validatePlan(emptyPlanInput(), { isCreate: true, catalog: [pro] });
    expect(Object.keys(errors).sort()).toEqual(["key", "monthlyEur", "name"]);
  });

  it("passes validation once name, key and price are set", () => {
    const input = { ...emptyPlanInput(), name: "Team", key: "team", monthlyEur: 40 };
    expect(validatePlan(input, { isCreate: true, catalog: [pro] })).toEqual({});
  });
});

describe("visibilityBadge", () => {
  it("labels the trial by its kind, not its (hidden) visibility", () => {
    expect(visibilityBadge({ kind: "trial", visibility: "hidden" })).toEqual({ label: "Trial", variant: "warning" });
  });

  it("maps each paid visibility to a badge", () => {
    expect(visibilityBadge({ kind: "paid", visibility: "public" })).toEqual({ label: "Public", variant: "success" });
    expect(visibilityBadge({ kind: "paid", visibility: "hidden" })).toEqual({ label: "Hidden", variant: "info" });
    expect(visibilityBadge({ kind: "paid", visibility: "retired" })).toEqual({ label: "Retired", variant: "default" });
  });
});

describe("number field helpers", () => {
  it("parses an empty required field to NaN so validatePlan flags it", () => {
    expect(parseNumberField("")).toBeNaN();
    expect(parseNumberField("12.5")).toBe(12.5);
  });

  it("parses an empty optional field to null", () => {
    expect(parseOptionalNumberField("")).toBeNull();
    expect(parseOptionalNumberField("30")).toBe(30);
  });

  it("renders null and NaN as an empty input", () => {
    expect(numberFieldValue(null)).toBe("");
    expect(numberFieldValue(NaN)).toBe("");
    expect(numberFieldValue(0)).toBe(0);
  });
});
