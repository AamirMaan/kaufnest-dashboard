import {
  emptyPurchaseInventoryFields,
  purchaseInventoryFieldsFrom,
  isPurchaseInventoryFieldsValid,
  purchaseInventoryPayload,
  hasLandedCosts,
  parseLandedPreview,
} from "./purchaseInventoryFields";

describe("purchase inventory fields", () => {
  it("starts on the default location with no landed costs", () => {
    const s = emptyPurchaseInventoryFields();
    expect(s).toEqual({ locationId: "", freight: "", customs: "", other: "" });
    expect(hasLandedCosts(s)).toBe(false);
    expect(purchaseInventoryPayload(s)).toEqual({ location_id: null, freight_cost: null, customs_cost: null, other_cost: null });
  });

  it("round-trips an existing purchase", () => {
    const s = purchaseInventoryFieldsFrom({ location_id: "fba", freight_cost: 10, customs_cost: null, other_cost: 2.5 });
    expect(s).toEqual({ locationId: "fba", freight: "10", customs: "", other: "2.5" });
    expect(hasLandedCosts(s)).toBe(true);
  });

  it("treats missing fields on older purchases as empty", () => {
    expect(purchaseInventoryFieldsFrom({})).toEqual(emptyPurchaseInventoryFields());
  });

  it("parses costs to 2 decimals and rejects negatives or non-numbers", () => {
    const ok = { locationId: "main", freight: " 12.345 ", customs: "0", other: "" };
    expect(isPurchaseInventoryFieldsValid(ok)).toBe(true);
    expect(purchaseInventoryPayload(ok)).toEqual({ location_id: "main", freight_cost: 12.35, customs_cost: 0, other_cost: null });
    expect(isPurchaseInventoryFieldsValid({ ...ok, customs: "-1" })).toBe(false);
    expect(isPurchaseInventoryFieldsValid({ ...ok, other: "abc" })).toBe(false);
  });

  it("reads costs leniently for the live read-out", () => {
    expect(parseLandedPreview("2.5")).toBe(2.5);
    expect(parseLandedPreview("")).toBe(0);
    expect(parseLandedPreview("-1")).toBe(0);
  });
});
