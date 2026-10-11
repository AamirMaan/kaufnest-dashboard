import { resolvePlanKey } from "./resolvePlanKey";

const paidPlanKeys = new Set(["starter", "pro", "business"]);
const priceToPlan = new Map([["price_old_pro", "pro"], ["price_biz", "business"]]);

it("prefers the billed price over metadata (price swapped in the Stripe dashboard)", () => {
  expect(resolvePlanKey({ metadataPlan: "pro", priceId: "price_biz", paidPlanKeys, priceToPlan })).toBe("business");
});
it("resolves grandfathered prices from the price history", () => {
  expect(resolvePlanKey({ metadataPlan: undefined, priceId: "price_old_pro", paidPlanKeys, priceToPlan })).toBe("pro");
  expect(resolvePlanKey({ metadataPlan: "gone", priceId: "price_biz", paidPlanKeys, priceToPlan })).toBe("business");
});
it("falls back to a known metadata plan when the price is not in the history", () => {
  expect(resolvePlanKey({ metadataPlan: "pro", priceId: "price_unknown", paidPlanKeys, priceToPlan })).toBe("pro");
});
it("never resolves to the trial", () => {
  expect(resolvePlanKey({ metadataPlan: "trial", priceId: null, paidPlanKeys, priceToPlan })).toBeNull();
});
it("returns null when nothing matches (no silent starter default)", () => {
  expect(resolvePlanKey({ metadataPlan: undefined, priceId: "price_unknown", paidPlanKeys, priceToPlan })).toBeNull();
  expect(resolvePlanKey({ metadataPlan: null, priceId: null, paidPlanKeys, priceToPlan })).toBeNull();
});
it("ignores a price mapped to a plan that is no longer paid/known", () => {
  expect(resolvePlanKey({ metadataPlan: null, priceId: "x", paidPlanKeys, priceToPlan: new Map([["x", "trial"]]) })).toBeNull();
});
