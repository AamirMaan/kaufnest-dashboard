import { suggestedFulfillmentLocationId, fulfillmentStockWarning, fulfillmentWarningText } from "./fulfillmentLocation";
import type { InventorySettings, StockLocation } from "@/types";

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id, name: id.toUpperCase(), type: "own", is_active: true, created_by: null, created_at: "2026-09-26T00:00:00.000Z", ...overrides,
});
const settings: InventorySettings = { advanced_enabled: true, enabled_at: null, default_location_id: "main" };

describe("suggestedFulfillmentLocationId", () => {
  const locations = [loc("main"), loc("fba", { type: "fba" }), loc("old", { is_active: false })];

  it("uses the platform default when it is active", () => {
    expect(suggestedFulfillmentLocationId("amazon", [{ platform: "amazon", location_id: "fba" }], locations, settings)).toBe("fba");
  });

  it("falls back to the tenant default for an inactive or missing platform default", () => {
    expect(suggestedFulfillmentLocationId("ebay", [{ platform: "ebay", location_id: "old" }], locations, settings)).toBe("main");
    expect(suggestedFulfillmentLocationId("etsy", [], locations, settings)).toBe("main");
    expect(suggestedFulfillmentLocationId("etsy", [], locations, null)).toBe("");
  });
});

describe("fulfillmentStockWarning", () => {
  it("warns when the location has fewer units than ordered", () => {
    expect(fulfillmentStockWarning(loc("main"), 1, 3)).toEqual({ kind: "short", available: 1 });
    expect(fulfillmentStockWarning(loc("main"), -2, 1)).toEqual({ kind: "short", available: 0 });
  });

  it("is quiet when stock covers the order or stock is unknown", () => {
    expect(fulfillmentStockWarning(loc("main"), 5, 3)).toBeNull();
    expect(fulfillmentStockWarning(loc("main"), null, 3)).toBeNull();
    expect(fulfillmentStockWarning(undefined, 0, 3)).toBeNull();
  });

  it("explains dropship locations instead of counting stock", () => {
    expect(fulfillmentStockWarning(loc("ds", { type: "dropship" }), 0, 3)).toEqual({ kind: "dropship" });
  });
});

describe("fulfillmentWarningText", () => {
  it("words both warnings", () => {
    expect(fulfillmentWarningText({ kind: "short", available: 1 }, "Main")).toBe(
      "Only 1 in stock at Main. The order will still be saved; the missing units are costed at the last known price until stock arrives.",
    );
    expect(fulfillmentWarningText({ kind: "dropship" }, "Supplier")).toBe(
      "Supplier is a dropship supplier: no stock is taken, so link a purchase to record the cost of goods.",
    );
  });
});
