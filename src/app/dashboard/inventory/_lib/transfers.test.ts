import {
  emptyTransferDraft,
  fifoPreview,
  parseTransferCost,
  parseTransferQuantity,
  transferCostAddon,
  transferDraftError,
  transferInsertPayload,
  transferLocationOptions,
  type TransferDraft,
} from "./transfers";
import type { StockLocation, StockLot } from "@/types";

const lot = (id: string, overrides: Partial<StockLot> = {}): StockLot => ({
  id,
  product_id: "p1",
  location_id: "main",
  purchase_id: null,
  source_lot_id: null,
  kind: "purchase",
  received_at: "2026-09-01T00:00:00.000Z",
  cost_addon: 0,
  unit_cost: 10,
  qty_received: 5,
  qty_remaining: 5,
  created_at: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id,
  name: id,
  type: "own",
  is_active: true,
  created_by: null,
  created_at: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const locations = [loc("main"), loc("fba", { type: "fba" }), loc("drop", { type: "dropship" }), loc("old", { is_active: false })];

const draft = (overrides: Partial<TransferDraft> = {}): TransferDraft => ({
  productId: "p1",
  fromLocationId: "main",
  toLocationId: "fba",
  quantity: "3",
  transferCost: "",
  date: "2026-09-26",
  note: "",
  ...overrides,
});

describe("transferCostAddon", () => {
  it("is 0 without a cost", () => {
    expect(transferCostAddon(null, 3)).toBe(0);
    expect(transferCostAddon(0, 3)).toBe(0);
  });
  it("rounds cost per unit to 4 decimals like the trigger", () => {
    expect(transferCostAddon(10, 3)).toBe(3.3333);
    expect(transferCostAddon(5, 2)).toBe(2.5);
  });
  it("is 0 for a non-positive quantity", () => {
    expect(transferCostAddon(10, 0)).toBe(0);
  });
});

describe("fifoPreview", () => {
  it("takes from one lot when it covers the quantity", () => {
    const p = fifoPreview([lot("a")], 3, null);
    expect(p.available).toBe(5);
    expect(p.portions.map((x) => [x.lot.id, x.take, x.sourceUnitCost, x.destUnitCost])).toEqual([["a", 3, 10, 10]]);
    expect(p.movedQty).toBe(3);
    expect(p.shortBy).toBe(0);
    expect(p.movedCost).toBe(30);
    expect(p.destAvgUnitCost).toBe(10);
  });

  it("splits across lots oldest first (received_at, then created_at, then id)", () => {
    const lots = [
      lot("new", { received_at: "2026-09-10T00:00:00.000Z", unit_cost: 20, qty_remaining: 4 }),
      lot("old-b", { unit_cost: 12, qty_remaining: 1, created_at: "2026-09-02T00:00:00.000Z" }),
      lot("old-a", { unit_cost: 10, qty_remaining: 2 }),
    ];
    const p = fifoPreview(lots, 5, null);
    expect(p.portions.map((x) => [x.lot.id, x.take])).toEqual([["old-a", 2], ["old-b", 1], ["new", 2]]);
    expect(p.movedCost).toBe(2 * 10 + 12 + 2 * 20);
    expect(p.destAvgUnitCost).toBe(14.4);
  });

  it("adds the per-unit transfer cost share to every portion", () => {
    const p = fifoPreview([lot("a", { unit_cost: 10, qty_remaining: 2 }), lot("b", { unit_cost: 11, received_at: "2026-09-05T00:00:00.000Z" })], 3, 10);
    expect(p.addon).toBe(3.3333);
    expect(p.portions.map((x) => x.destUnitCost)).toEqual([13.3333, 14.3333]);
    expect(p.movedCost).toBe(41);
    expect(p.destAvgUnitCost).toBe(13.6666);
  });

  it("ignores shortfall and empty lots, and reports the shortage", () => {
    const lots = [lot("s", { kind: "shortfall", qty_remaining: -2, qty_received: 0 }), lot("z", { qty_remaining: 0 }), lot("a", { qty_remaining: 2 })];
    const p = fifoPreview(lots, 5, null);
    expect(p.available).toBe(2);
    expect(p.movedQty).toBe(2);
    expect(p.shortBy).toBe(3);
  });

  it("has no average when nothing moves", () => {
    const p = fifoPreview([], 3, null);
    expect(p.portions).toEqual([]);
    expect(p.destAvgUnitCost).toBeNull();
    expect(p.shortBy).toBe(3);
  });

  it("treats a zero or negative quantity as nothing to move", () => {
    const p = fifoPreview([lot("a")], 0, 5);
    expect(p.portions).toEqual([]);
    expect(p.shortBy).toBe(0);
    expect(p.addon).toBe(0);
  });

  it("accepts numeric strings for unit_cost (PostgREST numeric)", () => {
    const p = fifoPreview([lot("a", { unit_cost: "9.5" as unknown as number })], 2, null);
    expect(p.portions[0].sourceUnitCost).toBe(9.5);
    expect(p.movedCost).toBe(19);
  });
});

describe("transferLocationOptions", () => {
  it("keeps active, non-dropship locations sorted by name", () => {
    expect(transferLocationOptions(locations).map((l) => l.id)).toEqual(["fba", "main"]);
  });
});

describe("emptyTransferDraft", () => {
  it("defaults the source to the tenant default and the date to today", () => {
    expect(emptyTransferDraft("main", "2026-09-26")).toEqual(draft({ productId: "", toLocationId: "", quantity: "" }));
  });
  it("leaves the source empty when there is no default", () => {
    expect(emptyTransferDraft(null, "2026-09-26").fromLocationId).toBe("");
  });
});

describe("parseTransferQuantity", () => {
  it("accepts positive whole numbers", () => {
    expect(parseTransferQuantity("3")).toBe(3);
    expect(parseTransferQuantity(" 12 ")).toBe(12);
  });
  it("rejects empty, zero, negative and fractional values", () => {
    for (const raw of ["", "0", "-1", "1.5", "abc"]) expect(parseTransferQuantity(raw)).toBeNull();
  });
});

describe("parseTransferCost", () => {
  it("treats empty as no cost", () => {
    expect(parseTransferCost("  ")).toEqual({ valid: true, value: null });
  });
  it("parses and rounds to cents", () => {
    expect(parseTransferCost("12.346")).toEqual({ valid: true, value: 12.35 });
    expect(parseTransferCost("0")).toEqual({ valid: true, value: 0 });
  });
  it("rejects negative and non-numeric input", () => {
    expect(parseTransferCost("-1").valid).toBe(false);
    expect(parseTransferCost("x").valid).toBe(false);
  });
});

describe("transferDraftError", () => {
  it("is null for a complete draft within availability", () => {
    expect(transferDraftError(draft(), locations, 5)).toBeNull();
  });
  it("skips the availability check while availability is unknown", () => {
    expect(transferDraftError(draft({ quantity: "50" }), locations, null)).toBeNull();
  });
  it.each([
    [{ productId: "" }, "Choose a product."],
    [{ fromLocationId: "" }, "Choose where the stock comes from."],
    [{ toLocationId: "" }, "Choose where the stock goes."],
    [{ fromLocationId: "drop" }, "Choose where the stock comes from."],
    [{ toLocationId: "old" }, "Choose where the stock goes."],
    [{ toLocationId: "main" }, "The source and destination must be different locations."],
    [{ quantity: "1.5" }, "Enter a whole number of units, 1 or more."],
    [{ transferCost: "-2" }, "The transfer cost can't be negative."],
    [{ date: "" }, "Choose a date."],
  ])("reports %o", (overrides, message) => {
    expect(transferDraftError(draft(overrides), locations, 5)).toBe(message);
  });
  it("blocks more units than the source has", () => {
    expect(transferDraftError(draft({ quantity: "6" }), locations, 5)).toBe("Only 5 units are available at the source location.");
    expect(transferDraftError(draft({ quantity: "2" }), locations, 1)).toBe("Only 1 unit is available at the source location.");
  });
});

describe("transferInsertPayload", () => {
  it("builds the row the trigger expects", () => {
    expect(transferInsertPayload(draft({ transferCost: "7.5", note: "  pallet 4 " }), "u1")).toEqual({
      product_id: "p1",
      from_location_id: "main",
      to_location_id: "fba",
      quantity: 3,
      transfer_cost: 7.5,
      date: "2026-09-26",
      note: "pallet 4",
      created_by: "u1",
    });
  });
  it("sends null for an empty cost and note", () => {
    const p = transferInsertPayload(draft(), "u1");
    expect(p.transfer_cost).toBeNull();
    expect(p.note).toBeNull();
  });
});
