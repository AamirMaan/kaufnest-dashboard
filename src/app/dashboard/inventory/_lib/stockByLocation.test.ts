import { stockColumns, summarizeStock, locationTotals, OTHER_COLUMN_ID } from "./stockByLocation";
import type { StockLocation } from "@/types";

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id, name: id, type: "own", is_active: true, created_by: null, created_at: "2026-09-26T00:00:00.000Z", ...overrides,
});

describe("stockColumns", () => {
  it("shows up to four active stock-holding locations by name, then Other", () => {
    const cols = stockColumns([
      loc("e"), loc("d"), loc("c"), loc("b"), loc("a"),
      loc("ds", { type: "dropship" }),
    ]);
    expect(cols.map((c) => c.id)).toEqual(["a", "b", "c", "d", OTHER_COLUMN_ID]);
  });

  it("adds Other for inactive stock-holding locations, never for dropship-only extras", () => {
    expect(stockColumns([loc("a"), loc("old", { is_active: false })]).map((c) => c.id)).toEqual(["a", OTHER_COLUMN_ID]);
    expect(stockColumns([loc("a"), loc("ds", { type: "dropship" })]).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("summarizeStock", () => {
  const columns = [{ id: "main", label: "Main" }, { id: "fba", label: "FBA" }, { id: OTHER_COLUMN_ID, label: "Other" }];

  it("puts shown locations in their own cell and everything else in Other", () => {
    const s = summarizeStock([
      { product_id: "p", location_id: "main", qty: 10, positive_qty: 10, stock_value: 100 },
      { product_id: "p", location_id: "fba", qty: -2, positive_qty: 0, stock_value: 0 },
      { product_id: "p", location_id: "x", qty: 3, positive_qty: 3, stock_value: 45 },
    ], columns);
    expect(s.p.cells).toEqual({ main: 10, fba: -2, [OTHER_COLUMN_ID]: 3 });
    expect(s.p.total).toBe(11);
    expect(s.p.avgUnitCost).toBe(11.15); // (100 + 45) / 13
  });

  it("has no average cost when nothing is on hand", () => {
    const s = summarizeStock([{ product_id: "p", location_id: "main", qty: -1, positive_qty: 0, stock_value: 0 }], columns);
    expect(s.p.avgUnitCost).toBeNull();
  });

  it("accepts numeric strings from PostgREST", () => {
    const s = summarizeStock(
      [{ product_id: "p", location_id: "main", qty: 2, positive_qty: 2, stock_value: "3.50" as unknown as number }],
      columns,
    );
    expect(s.p.avgUnitCost).toBe(1.75);
  });
});

describe("locationTotals", () => {
  it("maps location id to quantity", () => {
    expect(locationTotals([{ location_id: "a", qty: 4 }, { location_id: "b", qty: -1 }])).toEqual({ a: 4, b: -1 });
  });
});
