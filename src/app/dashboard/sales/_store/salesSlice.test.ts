import { salesSlice, hydratePage, addSale, updateSale, removeSale, setFetching } from "./salesSlice";
import type { Sale } from "@/types";
import { DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

const makeSale = (overrides: Partial<Sale> = {}): Sale => ({
  id: "sale-1",
  platform: "amazon",
  product_name: "Test Product",
  quantity: 2,
  unit_price: 50,
  total_amount: 100,
  currency: "EUR",
  date: "2026-06-01",
  description: null,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  product_id: null,
  vat_rate: null,
  vat_amount: null,
  shipping_cost: null,
  shipping_charged: null,
  advertising_fee: null,
  platform_fee: null,
  status: "pending",
  restock: false,
  refunded_amount: null,
  external_order_id: null,
  tracking_number: null,
  shipping_carrier: null,
  ebay_fulfillment_id: null,
  ebay_sync_error: null,
  ebay_synced_at: null,
  ...overrides,
});

describe("salesSlice", () => {
  const { reducer } = salesSlice;

  it("starts with an empty items array and loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("starts with default pagination state", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
  });

  it("hydratePage replaces items and sets pagination fields", () => {
    const sales = [makeSale(), makeSale({ id: "sale-2" })];
    const state = reducer(
      undefined,
      hydratePage({ data: sales, count: 120, page: 2, pageSize: 50 })
    );
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(120);
    expect(state.isFetching).toBe(false);
  });

  it("hydratePage page 1 works correctly", () => {
    const sales = [makeSale()];
    const state = reducer(
      undefined,
      hydratePage({ data: sales, count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.page).toBe(1);
    expect(state.total).toBe(1);
  });

  it("setFetching sets isFetching flag", () => {
    const state1 = reducer(undefined, setFetching(true));
    expect(state1.isFetching).toBe(true);
    const state2 = reducer(state1, setFetching(false));
    expect(state2.isFetching).toBe(false);
  });

  it("prepends a new sale via addSale and increments total", () => {
    const existing = makeSale({ id: "sale-old" });
    const initial = reducer(
      undefined,
      hydratePage({ data: [existing], count: 1, page: 1, pageSize: 50 })
    );
    const newSale = makeSale({ id: "sale-new", product_name: "New Item" });
    const state = reducer(initial, addSale(newSale));
    expect(state.items[0].id).toBe("sale-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("addSale increments total correctly from non-zero baseline", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeSale({ id: "a" }), makeSale({ id: "b" })], count: 10, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, addSale(makeSale({ id: "c" })));
    expect(state.total).toBe(11);
  });

  it("updates an existing sale in place", () => {
    const sale = makeSale();
    const initial = reducer(
      undefined,
      hydratePage({ data: [sale], count: 1, page: 1, pageSize: 50 })
    );
    const updated = makeSale({ product_name: "Updated Product" });
    const state = reducer(initial, updateSale(updated));
    expect(state.items[0].product_name).toBe("Updated Product");
  });

  it("does nothing on updateSale when id not found", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeSale()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, updateSale(makeSale({ id: "missing" })));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("sale-1");
  });

  it("removes a sale by id and decrements total", () => {
    const sales = [makeSale({ id: "a" }), makeSale({ id: "b" })];
    const initial = reducer(
      undefined,
      hydratePage({ data: sales, count: 5, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, removeSale("a"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("b");
    expect(state.total).toBe(4);
  });

  it("does nothing on removeSale when id not found — total unchanged", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeSale()], count: 3, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, removeSale("nonexistent"));
    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(3);
  });
});
