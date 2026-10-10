import type { Plan } from "@/lib/plans/entitlements";
import { planOptions } from "./planOptions";

function plan(over: Partial<Plan> & Pick<Plan, "key" | "name" | "sortOrder">): Plan {
  return {
    kind: "paid",
    tagline: "",
    visibility: "public",
    monthlyEur: 10,
    stripeProductId: null,
    stripePriceId: null,
    maxUsers: null,
    platformIntegrations: false,
    aiFeatures: false,
    aiGenerationsPerMonth: 0,
    messagingAndListings: false,
    advancedInventory: false,
    trialDays: null,
    highlighted: false,
    ...over,
  };
}

// Deliberately out of order — planOptions sorts by sortOrder.
const catalog: Plan[] = [
  plan({ key: "old", name: "Old", sortOrder: 5, visibility: "retired" }),
  plan({ key: "pro", name: "Pro", sortOrder: 2 }),
  plan({ key: "trial", name: "Trial", sortOrder: 0, kind: "trial", visibility: "hidden", monthlyEur: null, trialDays: 14 }),
  plan({ key: "deal", name: "Deal", sortOrder: 4, visibility: "hidden" }),
  plan({ key: "starter", name: "Starter", sortOrder: 1 }),
];

describe("planOptions", () => {
  it("lists assignable plans in display order and excludes retired ones", () => {
    expect(planOptions(catalog, "pro")).toEqual([
      { value: "trial", label: "Trial (14 days)" },
      { value: "starter", label: "Starter" },
      { value: "pro", label: "Pro" },
      { value: "deal", label: "Deal (hidden)" },
    ]);
  });

  it("includes a retired plan when it is the tenant's current plan", () => {
    expect(planOptions(catalog, "old")).toEqual([
      { value: "trial", label: "Trial (14 days)" },
      { value: "starter", label: "Starter" },
      { value: "pro", label: "Pro" },
      { value: "deal", label: "Deal (hidden)" },
      { value: "old", label: "Old (retired)" },
    ]);
  });

  it("appends the current key as unknown when it is not in the catalog", () => {
    const opts = planOptions(catalog, "legacy_gold");
    expect(opts[opts.length - 1]).toEqual({ value: "legacy_gold", label: "legacy_gold (unknown)" });
    expect(opts.filter((o) => o.value === "legacy_gold")).toHaveLength(1);
  });

  it("excludes retired plans for a new tenant", () => {
    expect(planOptions(catalog, null).map((o) => o.value)).not.toContain("old");
  });
});
