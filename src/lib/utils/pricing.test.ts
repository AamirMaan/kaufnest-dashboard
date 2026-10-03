import { pricedPlans } from "./pricing";
import type { Plan } from "@/lib/plans/entitlements";

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

const trial = plan({ key: "trial", kind: "trial", name: "Trial", visibility: "hidden", monthlyEur: null, trialDays: 14, sortOrder: 0 });
const starter = plan({ key: "starter", name: "Starter", monthlyEur: 20, maxUsers: 3, platformIntegrations: false, sortOrder: 1 });
const pro = plan({ key: "pro", name: "Pro", monthlyEur: 30, maxUsers: 5, sortOrder: 2, highlighted: true });
const business = plan({ key: "business", name: "Business", monthlyEur: 50, maxUsers: null, sortOrder: 3 });

describe("pricedPlans", () => {
  it("returns only paid plans with a price, sorted by sortOrder", () => {
    const unpriced = plan({ key: "custom", monthlyEur: null, sortOrder: 4 });
    expect(pricedPlans([business, trial, unpriced, pro, starter]).map((p) => p.plan)).toEqual([
      "starter",
      "pro",
      "business",
    ]);
  });

  it("does not filter on visibility — callers do", () => {
    const hidden = plan({ key: "acme", visibility: "hidden", sortOrder: 5 });
    expect(pricedPlans([hidden]).map((p) => p.plan)).toEqual(["acme"]);
  });

  it("describes the user cap", () => {
    const byKey = Object.fromEntries(
      pricedPlans([business, pro, plan({ key: "solo", maxUsers: 1 })]).map((p) => [p.plan, p.users]),
    );
    expect(byKey.business).toBe("Unlimited users");
    expect(byKey.pro).toBe("Up to 5 users");
    expect(byKey.solo).toBe("Up to 1 user");
  });

  it("derives feature ticks from the plan flags", () => {
    const [card] = pricedPlans([
      plan({ platformIntegrations: true, messagingAndListings: false, aiFeatures: true, aiGenerationsPerMonth: 10 }),
    ]);
    expect(card.features).toEqual([
      { label: "Sales, expenses, purchases & inventory", included: true },
      { label: "VAT tracking & PDF invoices", included: true },
      { label: "CSV import & export", included: true },
      { label: "Full audit trail", included: true },
      { label: "eBay & Amazon order import", included: true },
      { label: "eBay listings & buyer messages", included: false },
      { label: "AI-assisted insights", included: true },
    ]);
  });

  it("copies highlighted, name, tagline and monthlyEur from the plan", () => {
    const [card] = pricedPlans([plan({ name: "Growth", tagline: "Grow it.", monthlyEur: 42.5, highlighted: true })]);
    expect(card).toMatchObject({ name: "Growth", tagline: "Grow it.", monthlyEur: 42.5, highlighted: true });
  });
});
