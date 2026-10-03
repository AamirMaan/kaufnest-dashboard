import { resolvePlanKey } from "./resolvePlanKey";

const paidPlanKeys = new Set(["starter", "pro", "business"]);
const priceToPlan = new Map([["price_old_pro", "pro"], ["price_biz", "business"]]);

it("prefers a known metadata plan", () => {
  expect(resolvePlanKey({ metadataPlan: "pro", priceId: "price_biz", paidPlanKeys, priceToPlan })).toBe("pro");
});
it("falls back to the price history", () => {
  expect(resolvePlanKey({ metadataPlan: undefined, priceId: "price_old_pro", paidPlanKeys, priceToPlan })).toBe("pro");
  expect(resolvePlanKey({ metadataPlan: "gone", priceId: "price_biz", paidPlanKeys, priceToPlan })).toBe("business");
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
