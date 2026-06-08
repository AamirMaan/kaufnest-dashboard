import { inventorySlice, hydrateProducts, addProduct, updateProduct, removeProduct } from "./inventorySlice";
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

describe("inventorySlice", () => {
  const { reducer } = inventorySlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates products", () => {
    const products = [makeProduct()];
    const state = reducer(undefined, hydrateProducts(products));
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new product via addProduct", () => {
    const initial = reducer(undefined, hydrateProducts([makeProduct()]));
    const newProduct = makeProduct({ id: "product-new" });
    const state = reducer(initial, addProduct(newProduct));
    expect(state.items[0].id).toBe("product-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing product", () => {
    const initial = reducer(undefined, hydrateProducts([makeProduct()]));
    const updated = makeProduct({ current_stock: 80 });
    const state = reducer(initial, updateProduct(updated));
    expect(state.items[0].current_stock).toBe(80);
  });

  it("removes a product by id", () => {
    const initial = reducer(
      undefined,
      hydrateProducts([makeProduct({ id: "p1" }), makeProduct({ id: "p2" })])
    );
    const state = reducer(initial, removeProduct("p1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("p2");
  });
});
