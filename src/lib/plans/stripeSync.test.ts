import type { Plan } from "./entitlements";
import {
  createStripePlan,
  deactivateStripePrice,
  PlanSyncError,
  syncStripePlan,
  toCents,
  type StripePlanApi,
} from "./stripeSync";
import type { PlanInput } from "./validatePlan";

const makeStripe = (): StripePlanApi => ({
  products: {
    create: jest.fn().mockResolvedValue({ id: "prod_new" }),
    update: jest.fn().mockResolvedValue({}),
  },
  prices: {
    create: jest.fn().mockResolvedValue({ id: "price_new" }),
    update: jest.fn().mockResolvedValue({}),
  },
});

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

describe("toCents", () => {
  it("converts euros to integer cents", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(20)).toBe(2000);
  });
});

describe("createStripePlan", () => {
  it("creates a product then a price, with idempotency keys derived from the key/amount", async () => {
    const stripe = makeStripe();
    const result = await createStripePlan(stripe, {
      key: "enterprise",
      name: "Enterprise",
      tagline: "Big",
      monthlyEur: 99,
    });

    expect(result).toEqual({ productId: "prod_new", priceId: "price_new" });
    expect(stripe.products.create).toHaveBeenCalledWith(
      { name: "Boughtopia Enterprise", description: "Big", metadata: { plan_key: "enterprise" } },
      { idempotencyKey: "plan-create-product-enterprise" }
    );
    expect(stripe.prices.create).toHaveBeenCalledWith(
      {
        product: "prod_new",
        currency: "eur",
        unit_amount: 9900,
        recurring: { interval: "month" },
        metadata: { plan_key: "enterprise" },
      },
      { idempotencyKey: "plan-create-price-enterprise-9900" }
    );
  });

  it("omits description when the tagline is empty", async () => {
    const stripe = makeStripe();
    await createStripePlan(stripe, { key: "enterprise", name: "Enterprise", tagline: "", monthlyEur: 99 });

    const [productArgs] = (stripe.products.create as jest.Mock).mock.calls[0];
    expect(productArgs).not.toHaveProperty("description");
  });
});

describe("syncStripePlan", () => {
  it("makes no Stripe calls for an unchanged paid plan", async () => {
    const stripe = makeStripe();
    const before = basePlan();
    const result = await syncStripePlan(stripe, before, baseInput());

    expect(result).toEqual({});
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.products.update).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.prices.update).not.toHaveBeenCalled();
  });

  it("creates a new price on a price change, but does NOT deactivate the old one itself", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", stripeProductId: "prod_p", stripePriceId: "price_p", monthlyEur: 30 });
    const after = baseInput({ key: "pro", monthlyEur: 35 });

    const result = await syncStripePlan(stripe, before, after);

    expect(stripe.prices.create).toHaveBeenCalledWith(
      {
        product: "prod_p",
        currency: "eur",
        unit_amount: 3500,
        recurring: { interval: "month" },
        metadata: { plan_key: "pro" },
      },
      { idempotencyKey: "plan-price-pro-3500-price_p" }
    );
    // Deactivation is the CALLER's job, run only after its own DB write
    // commits — see deactivateStripePrice below and the PATCH route.
    expect(stripe.prices.update).not.toHaveBeenCalled();
    expect(result).toEqual({ priceId: "price_new", deactivatePriceId: "price_p" });
  });

  it("updates the product name on a name change", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", name: "Pro", tagline: "", stripeProductId: "prod_p" });
    const after = baseInput({ key: "pro", name: "Pro Plus", tagline: "" });

    await syncStripePlan(stripe, before, after);

    expect(stripe.products.update).toHaveBeenCalledWith("prod_p", { name: "Boughtopia Pro Plus" });
  });

  it("includes description when the tagline changed and is non-empty", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", name: "Pro", tagline: "Old tagline", stripeProductId: "prod_p" });
    const after = baseInput({ key: "pro", name: "Pro Plus", tagline: "New tagline" });

    await syncStripePlan(stripe, before, after);

    expect(stripe.products.update).toHaveBeenCalledWith("prod_p", {
      name: "Boughtopia Pro Plus",
      description: "New tagline",
    });
  });

  it("deactivates the Stripe product when a plan is retired", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", visibility: "public", stripeProductId: "prod_p" });
    const after = baseInput({ key: "pro", visibility: "retired" });

    await syncStripePlan(stripe, before, after);

    expect(stripe.products.update).toHaveBeenCalledWith("prod_p", { active: false });
  });

  it("reactivates the Stripe product when a retired plan is unretired", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", visibility: "retired", stripeProductId: "prod_p" });
    const after = baseInput({ key: "pro", visibility: "hidden" });

    await syncStripePlan(stripe, before, after);

    expect(stripe.products.update).toHaveBeenCalledWith("prod_p", { active: true });
  });

  it("makes no product call for public → hidden", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", visibility: "public", stripeProductId: "prod_p" });
    const after = baseInput({ key: "pro", visibility: "hidden" });

    const result = await syncStripePlan(stripe, before, after);

    expect(stripe.products.update).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it("rejects a Stripe-affecting change on a plan never linked to Stripe", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", stripeProductId: null, stripePriceId: null, monthlyEur: 30 });
    const after = baseInput({ key: "pro", monthlyEur: 35 });

    await expect(syncStripePlan(stripe, before, after)).rejects.toThrow(PlanSyncError);
    await expect(syncStripePlan(stripe, before, after)).rejects.toThrow(
      "This plan isn't linked to Stripe yet. Run npm run plans:seed-stripe first."
    );
  });

  it("allows a non-Stripe-affecting change on a plan never linked to Stripe", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "pro", stripeProductId: null, stripePriceId: null, maxUsers: 5 });
    const after = baseInput({ key: "pro", maxUsers: 3 });

    const result = await syncStripePlan(stripe, before, after);
    expect(result).toEqual({});
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.products.update).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("never calls Stripe for a trial plan", async () => {
    const stripe = makeStripe();
    const before = basePlan({ key: "trial", kind: "trial", monthlyEur: null, trialDays: 14, visibility: "hidden" });
    const after = baseInput({ key: "trial", kind: "trial", monthlyEur: null, trialDays: 21, visibility: "hidden" });

    const result = await syncStripePlan(stripe, before, after);

    expect(result).toEqual({});
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.products.update).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.prices.update).not.toHaveBeenCalled();
  });
});

describe("deactivateStripePrice", () => {
  it("deactivates the given price", async () => {
    const stripe = makeStripe();
    await deactivateStripePrice(stripe, "price_p");
    expect(stripe.prices.update).toHaveBeenCalledWith("price_p", { active: false });
  });
});
