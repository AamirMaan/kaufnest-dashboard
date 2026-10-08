import type { PlatformPayout } from "@/types";
import { fetchPayoutsPage, payoutsSlice, PAYOUTS_LOAD_ERROR } from "./payoutsSlice";

const { reducer } = payoutsSlice;

const payout = (id: string): PlatformPayout => ({
  id,
  platform: "ebay",
  amount: 120.5,
  currency: "EUR",
  date: "2026-10-01",
  notes: null,
  created_by: "u1",
  created_at: "2026-10-01T09:00:00.000Z",
});

describe("payoutsSlice", () => {
  it("starts empty and not loaded", () => {
    expect(reducer(undefined, { type: "@@INIT" })).toEqual({
      items: [], page: 1, pageSize: 50, total: 0, loaded: false, isFetching: false, error: null,
    });
  });

  it("marks a fetch in flight and clears the last error", () => {
    const failed = { ...reducer(undefined, { type: "@@INIT" }), error: "boom" };
    const s = reducer(failed, { type: fetchPayoutsPage.pending.type });
    expect(s.isFetching).toBe(true);
    expect(s.error).toBeNull();
  });

  it("stores a fetched page", () => {
    const s = reducer(undefined, {
      type: fetchPayoutsPage.fulfilled.type,
      payload: { data: [payout("p1")], count: 51, page: 2, pageSize: 50 },
    });
    expect(s).toEqual({ items: [payout("p1")], page: 2, pageSize: 50, total: 51, loaded: true, isFetching: false, error: null });
  });

  it("keeps its rows and shows a fixed message when a fetch fails", () => {
    const loaded = reducer(undefined, {
      type: fetchPayoutsPage.fulfilled.type,
      payload: { data: [payout("p1")], count: 1, page: 1, pageSize: 50 },
    });
    const s = reducer(loaded, { type: fetchPayoutsPage.rejected.type, error: { message: "relation does not exist" } });
    expect(s.items).toEqual([payout("p1")]);
    expect(s.isFetching).toBe(false);
    expect(s.loaded).toBe(true);
    expect(s.error).toBe(PAYOUTS_LOAD_ERROR);
  });
});
