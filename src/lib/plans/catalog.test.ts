const rows = [
  { key: "trial", kind: "trial", name: "Trial", tagline: "", visibility: "hidden", monthly_eur: null,
    stripe_product_id: null, stripe_price_id: null, max_users: null, platform_integrations: true,
    ai_features: true, ai_generations_per_month: 300, messaging_and_listings: true, advanced_inventory: true,
    trial_days: 21, sort_order: 0, highlighted: false },
  { key: "pro", kind: "paid", name: "Pro", tagline: "", visibility: "public", monthly_eur: 30,
    stripe_product_id: "prod_p", stripe_price_id: "price_p", max_users: 5, platform_integrations: true,
    ai_features: false, ai_generations_per_month: 0, messaging_and_listings: false, advanced_inventory: false,
    trial_days: null, sort_order: 2, highlighted: true },
];

let plansResult: { data: unknown; error: unknown } = { data: rows, error: null };
const pricesResult: { data: unknown; error: unknown } = {
  data: [{ stripe_price_id: "price_old", plan_key: "pro" }, { stripe_price_id: "price_p", plan_key: "pro" }],
  error: null,
};
const from = jest.fn((table: string) => {
  const result = table === "plans" ? plansResult : pricesResult;
  const builder = {
    select: () => builder,
    order: () => builder,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
});

jest.mock("@/lib/supabase/control", () => ({
  createControlClient: () => ({ schema: () => ({ from }) }),
}));

import {
  getEntitlements,
  getPlan,
  getPlanCatalog,
  getPlanPriceMap,
  getTrialDays,
  invalidatePlanCatalog,
} from "./catalog";

beforeEach(() => {
  invalidatePlanCatalog();
  from.mockClear();
  plansResult = { data: rows, error: null };
});

it("loads and maps the catalog", async () => {
  const plans = await getPlanCatalog();
  expect(plans.map((p) => p.key)).toEqual(["trial", "pro"]);
  expect(plans[1].monthlyEur).toBe(30);
});

it("caches for 60 s", async () => {
  await getPlanCatalog();
  await getPlanCatalog();
  expect(from).toHaveBeenCalledTimes(1);
  invalidatePlanCatalog();
  await getPlanCatalog();
  expect(from).toHaveBeenCalledTimes(2);
});

it("expires the cache after 60 s", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  await getPlanCatalog();
  now.mockReturnValue(1_000_000 + 60_001);
  await getPlanCatalog();
  expect(from).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it("serves the stale cache on a read error, throws without one", async () => {
  await getPlanCatalog();
  invalidatePlanCatalog();
  plansResult = { data: null, error: { message: "boom" } };
  await expect(getPlanCatalog()).rejects.toThrow("Could not load plan catalog");
});

it("returns the previous catalog when a refresh fails", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(2_000_000);
  await getPlanCatalog();
  now.mockReturnValue(2_000_000 + 60_001);
  plansResult = { data: null, error: { message: "boom" } };
  const plans = await getPlanCatalog();
  expect(plans.map((p) => p.key)).toEqual(["trial", "pro"]);
  now.mockRestore();
});

it("getPlan / getEntitlements fail closed on unknown keys", async () => {
  expect(await getPlan("nope")).toBeNull();
  expect(await getPlan(null)).toBeNull();
  expect((await getEntitlements("nope")).platformIntegrations).toBe(false);
  expect((await getEntitlements("pro")).maxUsers).toBe(5);
});

it("getTrialDays reads the trial row, falls back to 14", async () => {
  expect(await getTrialDays()).toBe(21);
  invalidatePlanCatalog();
  plansResult = { data: rows.filter((r) => r.kind !== "trial"), error: null };
  expect(await getTrialDays()).toBe(14);
  invalidatePlanCatalog();
  plansResult = { data: null, error: { message: "boom" } };
  expect(await getTrialDays()).toBe(14);
});

it("getPlanPriceMap maps every historical price to its plan", async () => {
  const map = await getPlanPriceMap();
  expect(map.get("price_old")).toBe("pro");
  expect(map.get("price_p")).toBe("pro");
});
