import { fetchTransfersPage, transfersSlice, type StockTransferRow } from "./transfersSlice";

const { reducer } = transfersSlice;

const row = (id: string): StockTransferRow => ({
  id,
  product_id: "p1",
  product_name: "Mug",
  from_location_id: "main",
  to_location_id: "fba",
  quantity: 2,
  transfer_cost: null,
  date: "2026-09-26",
  note: null,
  created_by: "u1",
  created_at: "2026-09-26T10:00:00.000Z",
});

describe("transfersSlice", () => {
  it("starts empty and not loaded", () => {
    expect(reducer(undefined, { type: "@@INIT" })).toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      loaded: false,
      isFetching: false,
      error: null,
    });
  });

  it("marks a fetch in flight and clears the last error", () => {
    const failed = { ...reducer(undefined, { type: "@@INIT" }), error: "boom" };
    const s = reducer(failed, { type: fetchTransfersPage.pending.type });
    expect(s.isFetching).toBe(true);
    expect(s.error).toBeNull();
  });

  it("stores a fetched page", () => {
    const s = reducer(undefined, {
      type: fetchTransfersPage.fulfilled.type,
      payload: { data: [row("t1")], count: 51, page: 2, pageSize: 50 },
    });
    expect(s).toEqual({ items: [row("t1")], page: 2, pageSize: 50, total: 51, loaded: true, isFetching: false, error: null });
  });

  it("keeps the rows it has when a fetch fails", () => {
    const loaded = reducer(undefined, {
      type: fetchTransfersPage.fulfilled.type,
      payload: { data: [row("t1")], count: 1, page: 1, pageSize: 50 },
    });
    const s = reducer(loaded, { type: fetchTransfersPage.rejected.type, error: { message: "Could not load transfers." } });
    expect(s.items).toEqual([row("t1")]);
    expect(s.isFetching).toBe(false);
    expect(s.error).toBe("Could not load transfers.");
  });
});
