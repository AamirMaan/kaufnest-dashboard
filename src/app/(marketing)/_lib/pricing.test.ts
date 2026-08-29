import { pricedPlans } from "./pricing";
import { getPlanLimits } from "@/lib/utils/planGating";

describe("pricedPlans", () => {
  it("returns the three paid plans in ascending price order", () => {
    const plans = pricedPlans();
    expect(plans.map((p) => p.plan)).toEqual(["starter", "pro", "business"]);
    expect(plans.map((p) => p.monthlyEur)).toEqual([20, 30, 50]);
  });

  it("never offers the trial plan as something to buy", () => {
    expect(pricedPlans().some((p) => (p.plan as string) === "trial")).toBe(false);
  });

  // The whole point of deriving: the page cannot advertise a capability the
  // app actually gates off.
  it("derives every feature mark from PLAN_LIMITS", () => {
    for (const plan of pricedPlans()) {
      const limits = getPlanLimits(plan.plan);
      const mark = (label: string) =>
        plan.features.find((f) => f.label === label)?.included;

      expect(mark("eBay & Amazon order import")).toBe(limits.platformIntegrations);
      expect(mark("eBay listings & buyer messages")).toBe(limits.messagingAndListings);
      expect(mark("AI-assisted insights")).toBe(limits.aiFeatures);
    }
  });

  it("describes the user cap from PLAN_LIMITS", () => {
    const byPlan = Object.fromEntries(pricedPlans().map((p) => [p.plan, p]));
    expect(byPlan.starter.users).toBe("Up to 3 users");
    expect(byPlan.pro.users).toBe("Up to 5 users");
    expect(byPlan.business.users).toBe("Unlimited users");
  });

  it("highlights exactly one plan", () => {
    expect(pricedPlans().filter((p) => p.highlighted)).toHaveLength(1);
  });
});
