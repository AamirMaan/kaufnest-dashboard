import {
  inventorySlice,
  hydratePage,
  hydrateSelectors,
  hydrateProducts,
  addProduct,
  updateProduct,
  removeProduct,
  fetchInventoryPage,
  fetchInventorySelectors,
  type ProductSelector,
} from "./inventorySlice";
import type { Product } from "@/types";

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "product-1",
  name: "USB-C Cable",
  sku: "USB-C-01",
  current_stock: 100,
  reorder_threshold: 20,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const makeSelector = (overrides: Partial<ProductSelector> = {}): ProductSelector => ({
  id: "product-1",
  name: "USB-C Cable",
  sku: "USB-C-01",
  current_stock: 100,
  ...overrides,
});

describe("inventorySlice", () => {
  const { reducer } = inventorySlice;

  // ── Initial state ─────────────────────────────────────────────────────────

  it("starts empty with loaded=false and pagination defaults", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.page).toBe(1);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
    expect(state.selectorItems).toEqual([]);
    expect(state.selectorsLoaded).toBe(false);
  });

  // ── hydratePage (legacy hydrateProducts alias) ────────────────────────────

  it("hydratePage sets items, page, total, loaded", () => {
    const products = [makeProduct()];
    const state = reducer(undefined, hydratePage({ data: products, count: 42, page: 2, pageSize: 10 }));
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.page).toBe(2);
    expect(state.total).toBe(42);
    expect(state.isFetching).toBe(false);
  });

  it("hydrateProducts alias works identically to hydratePage", () => {
    const products = [makeProduct()];
    const state = reducer(undefined, hydrateProducts({ data: products, count: 5, page: 1, pageSize: 50 }));
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.total).toBe(5);
  });

  // ── hydrateSelectors ──────────────────────────────────────────────────────

  it("hydrateSelectors populates selectorItems and sets selectorsLoaded", () => {
    const selectors = [makeSelector(), makeSelector({ id: "p2", name: "Wireless Mouse" })];
    const state = reducer(undefined, hydrateSelectors(selectors));
    expect(state.selectorItems).toHaveLength(2);
    expect(state.selectorsLoaded).toBe(true);
  });

  // ── addProduct ────────────────────────────────────────────────────────────

  it("prepends a new product via addProduct and increments total", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeProduct()], count: 1, page: 1, pageSize: 50 })
    );
    const newProduct = makeProduct({ id: "product-new", name: "Wireless Mouse" });
    const state = reducer(initial, addProduct(newProduct));
    expect(state.items[0].id).toBe("product-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("addProduct also appends to selectorItems (sorted by name)", () => {
    const initial = reducer(undefined, hydrateSelectors([makeSelector({ id: "p1", name: "Zapper" })]));
    const newProduct = makeProduct({ id: "p2", name: "Alpha Widget" });
    const state = reducer(initial, addProduct(newProduct));
    expect(state.selectorItems).toHaveLength(2);
    expect(state.selectorItems[0].name).toBe("Alpha Widget");
  });

  // ── updateProduct ─────────────────────────────────────────────────────────

  it("updates an existing product in items", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeProduct()], count: 1, page: 1, pageSize: 50 })
    );
    const updated = makeProduct({ current_stock: 80 });
    const state = reducer(initial, updateProduct(updated));
    expect(state.items[0].current_stock).toBe(80);
  });

  it("updateProduct also updates selectorItems current_stock", () => {
    const s0 = reducer(undefined, hydrateSelectors([makeSelector({ id: "p1", current_stock: 100 })]));
    const s1 = reducer(s0, updateProduct(makeProduct({ id: "p1", current_stock: 55 })));
    expect(s1.selectorItems[0].current_stock).toBe(55);
  });

  // ── removeProduct ─────────────────────────────────────────────────────────

  it("removes a product by id and decrements total", () => {
    const initial = reducer(
      undefined,
      hydratePage({
        data: [makeProduct({ id: "p1" }), makeProduct({ id: "p2" })],
        count: 2,
        page: 1,
        pageSize: 50,
      })
    );
    const state = reducer(initial, removeProduct("p1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("p2");
    expect(state.total).toBe(1);
  });

  it("removeProduct also removes from selectorItems", () => {
    const s0 = reducer(
      undefined,
      hydrateSelectors([makeSelector({ id: "p1" }), makeSelector({ id: "p2", name: "Mouse" })])
    );
    const s1 = reducer(s0, removeProduct("p1"));
    expect(s1.selectorItems).toHaveLength(1);
    expect(s1.selectorItems[0].id).toBe("p2");
  });

  // ── fetchInventoryPage async thunk extra reducers ─────────────────────────

  it("sets isFetching=true on fetchInventoryPage.pending", () => {
    const state = reducer(undefined, { type: fetchInventoryPage.pending.type });
    expect(state.isFetching).toBe(true);
  });

  it("applies page data on fetchInventoryPage.fulfilled", () => {
    const payload = { data: [makeProduct()], count: 99, page: 3, pageSize: 10 };
    const state = reducer(undefined, { type: fetchInventoryPage.fulfilled.type, payload });
    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(99);
    expect(state.page).toBe(3);
    expect(state.isFetching).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it("clears isFetching on fetchInventoryPage.rejected", () => {
    const pending = reducer(undefined, { type: fetchInventoryPage.pending.type });
    const state = reducer(pending, { type: fetchInventoryPage.rejected.type });
    expect(state.isFetching).toBe(false);
  });

  // ── fetchInventorySelectors async thunk extra reducers ────────────────────

  it("populates selectorItems on fetchInventorySelectors.fulfilled", () => {
    const payload = [makeSelector({ id: "s1" }), makeSelector({ id: "s2", name: "Widget" })];
    const state = reducer(undefined, { type: fetchInventorySelectors.fulfilled.type, payload });
    expect(state.selectorItems).toHaveLength(2);
    expect(state.selectorsLoaded).toBe(true);
  });
});
