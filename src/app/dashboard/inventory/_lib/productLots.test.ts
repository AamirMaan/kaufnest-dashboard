import { lotSourceLabel, lotReceivedLabel, sortLotsFifo, canEditLotCost, parseUnitCostInput } from "./productLots";
import type { StockLot } from "@/types";

const lot = (id: string, overrides: Partial<StockLot> = {}): StockLot => ({
  id, product_id: "p", location_id: "main", purchase_id: null, source_lot_id: null, kind: "purchase",
  received_at: "2026-09-20T00:00:00.000Z", cost_addon: 0, unit_cost: 10, qty_received: 5, qty_remaining: 5,
  created_at: "2026-09-20T10:00:00.000Z", ...overrides,
});

describe("product lots", () => {
  it("labels each kind of batch", () => {
    expect(lotSourceLabel(lot("a"))).toBe("Purchase");
    expect(lotSourceLabel(lot("a", { kind: "opening" }))).toBe("Opening balance");
    expect(lotSourceLabel(lot("a", { kind: "transfer" }))).toBe("Transferred in");
    expect(lotSourceLabel(lot("a", { kind: "shortfall" }))).toBe("Shortfall (awaiting stock)");
  });

  it("shows the received date, but not the 1970 placeholder of opening batches", () => {
    expect(lotReceivedLabel(lot("a"))).toBe("2026-09-20");
    expect(lotReceivedLabel(lot("a", { kind: "opening", received_at: "1970-01-01T00:00:00.000Z" }))).toBe("Before tracking");
  });

  it("sorts oldest first like the ledger's FIFO", () => {
    const sorted = sortLotsFifo([
      lot("late", { received_at: "2026-09-21T00:00:00.000Z" }),
      lot("b", { created_at: "2026-09-20T11:00:00.000Z" }),
      lot("a"),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b", "late"]);
  });

  it("lets admins edit only opening-balance costs", () => {
    expect(canEditLotCost(lot("a", { kind: "opening" }), true)).toBe(true);
    expect(canEditLotCost(lot("a", { kind: "opening" }), false)).toBe(false);
    expect(canEditLotCost(lot("a"), true)).toBe(false);
  });

  it("parses a unit cost to 4 decimals", () => {
    expect(parseUnitCostInput(" 2.12345 ")).toBe(2.1235);
    expect(parseUnitCostInput("0")).toBe(0);
    expect(parseUnitCostInput("")).toBeNull();
    expect(parseUnitCostInput("-1")).toBeNull();
    expect(parseUnitCostInput("x")).toBeNull();
  });
});
