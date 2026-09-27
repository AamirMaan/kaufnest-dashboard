import {
  purchasesSlice,
  hydratePurchases,
  addPurchase,
  updatePurchase,
  removePurchase,
  fetchPurchasesPage,
  fetchPurchasesSummary,
} from "./purchasesSlice";
import type { Purchase } from "@/types";
import type { PurchaseFilters } from "@/lib/utils/filters";

const makePurchase = (overrides: Partial<Purchase> = {}): Purchase => ({
  id: "purchase-1",
  product_name: "Bulk Cable",
  quantity: 10,
  unit_price: 5,
  total_amount: 50,
  currency: "EUR",
  vendor: "Distributor GmbH",
  date: "2026-06-01",
  description: null,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  product_id: null,
  vat_rate: null,
  vat_amount: null,
  sale_id: null,
  original_currency: null,
  original_total_amount: null,
  fx_rate: null,
  fx_rate_date: null,
  ...overrides,
});

describe("purchasesSlice", () => {
  const { reducer } = purchasesSlice;

  it("starts empty with loaded=false and pagination defaults", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
  });

  it("hydrates purchases via hydratePurchases (hydratePage alias)", () => {
    const purchases = [makePurchase()];
    const state = reducer(
      undefined,
      hydratePurchases({ data: purchases, count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.total).toBe(1);
    expect(state.page).toBe(1);
    expect(state.isFetching).toBe(false);
  });

  it("prepends a new purchase via addPurchase and increments total", () => {
    const base = reducer(
      undefined,
      hydratePurchases({ data: [makePurchase()], count: 1, page: 1, pageSize: 50 })
    );
    const newPurchase = makePurchase({ id: "purchase-new" });
    const state = reducer(base, addPurchase(newPurchase));
    expect(state.items[0].id).toBe("purchase-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("updates an existing purchase", () => {
    const base = reducer(
      undefined,
      hydratePurchases({ data: [makePurchase()], count: 1, page: 1, pageSize: 50 })
    );
    const updated = makePurchase({ product_name: "Updated Cable" });
    const state = reducer(base, updatePurchase(updated));
    expect(state.items[0].product_name).toBe("Updated Cable");
  });

  it("removes a purchase by id and decrements total", () => {
    const base = reducer(
      undefined,
      hydratePurchases({
        data: [makePurchase({ id: "p1" }), makePurchase({ id: "p2" })],
        count: 2,
        page: 1,
        pageSize: 50,
      })
    );
    const state = reducer(base, removePurchase("p1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("p2");
    expect(state.total).toBe(1);
  });

  it("sets isFetching=true on fetchPurchasesPage.pending", () => {
    const state = reducer(undefined, fetchPurchasesPage.pending("req-id", { page: 1, pageSize: 50, filters: { preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" } }));
    expect(state.isFetching).toBe(true);
  });

  it("applies page data on fetchPurchasesPage.fulfilled", () => {
    const payload = {
      data: [makePurchase({ id: "p3" })],
      count: 7,
      page: 2,
      pageSize: 50,
    };
    const state = reducer(
      undefined,
      fetchPurchasesPage.fulfilled(payload, "req-id", { page: 2, pageSize: 50, filters: { preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" } })
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("p3");
    expect(state.total).toBe(7);
    expect(state.page).toBe(2);
    expect(state.isFetching).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it("clears isFetching on fetchPurchasesPage.rejected", () => {
    const pending = reducer(undefined, fetchPurchasesPage.pending("req-id", { page: 1, pageSize: 50, filters: { preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" } }));
    expect(pending.isFetching).toBe(true);
    const state = reducer(
      pending,
      fetchPurchasesPage.rejected(new Error("fail"), "req-id", { page: 1, pageSize: 50, filters: { preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" } })
    );
    expect(state.isFetching).toBe(false);
  });
});

describe("summary state", () => {
  const reducer = purchasesSlice.reducer;
  const init = () => reducer(undefined, { type: "@@init" });
  const filters: PurchaseFilters = { preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" };
  const row = { currency: "EUR" as const, purchase_count: 1, units: 3, gross: 30, vat: 0 };

  it("stores rows from the latest request only", () => {
    let s = reducer(init(), fetchPurchasesSummary.pending("req-1", filters));
    s = reducer(s, fetchPurchasesSummary.pending("req-2", filters));
    expect(s.summaryLoading).toBe(true);
    s = reducer(s, fetchPurchasesSummary.fulfilled([{ ...row, gross: 1 }], "req-1", filters));
    expect(s.summary).toEqual([]); // stale response ignored
    s = reducer(s, fetchPurchasesSummary.fulfilled([row], "req-2", filters));
    expect(s.summary).toEqual([row]);
    expect(s.summaryLoading).toBe(false);
    expect(s.summaryError).toBe(false);
  });

  it("flags an error for the latest request", () => {
    let s = reducer(init(), fetchPurchasesSummary.pending("req-1", filters));
    s = reducer(s, fetchPurchasesSummary.rejected(new Error("x"), "req-1", filters));
    expect(s.summaryError).toBe(true);
    expect(s.summaryLoading).toBe(false);
  });

  it("bumps summaryVersion on add, update and remove", () => {
    let s = init();
    const purchase = makePurchase();
    s = reducer(s, addPurchase(purchase));
    s = reducer(s, updatePurchase(purchase));
    s = reducer(s, removePurchase(purchase.id));
    expect(s.summaryVersion).toBe(3);
  });
});
