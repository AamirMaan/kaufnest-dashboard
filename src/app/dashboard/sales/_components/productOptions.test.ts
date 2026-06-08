import { selectableProducts, productNameFor } from "./productOptions";
import type { Product } from "@/types";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Wireless Mouse",
    sku: "WM-100",
    current_stock: 10,
    reorder_threshold: 5,
    created_by: "user-1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("selectableProducts", () => {
  it("includes only products with stock available", () => {
    const inStock = makeProduct({ id: "p1", current_stock: 10 });
    const outOfStock = makeProduct({ id: "p2", current_stock: 0 });

    expect(selectableProducts([inStock, outOfStock])).toEqual([inStock]);
  });

  it("excludes products with negative stock", () => {
    const negative = makeProduct({ id: "p1", current_stock: -3 });

    expect(selectableProducts([negative])).toEqual([]);
  });

  it("keeps the currently-linked product visible even at 0 stock", () => {
    const inStock = makeProduct({ id: "p1", current_stock: 10 });
    const linkedButDepleted = makeProduct({ id: "p2", current_stock: 0 });

    expect(selectableProducts([inStock, linkedButDepleted], "p2")).toEqual([inStock, linkedButDepleted]);
  });

  it("does not surface unrelated out-of-stock products just because some product is linked", () => {
    const linked = makeProduct({ id: "p1", current_stock: 5 });
    const unrelatedDepleted = makeProduct({ id: "p2", current_stock: 0 });

    expect(selectableProducts([linked, unrelatedDepleted], "p1")).toEqual([linked]);
  });

  it("returns an empty list when nothing is in stock and nothing is linked", () => {
    const depleted = makeProduct({ current_stock: 0 });

    expect(selectableProducts([depleted])).toEqual([]);
    expect(selectableProducts([depleted], "")).toEqual([]);
  });
});

describe("productNameFor", () => {
  it("returns the matching product's name", () => {
    const mouse = makeProduct({ id: "p1", name: "Wireless Mouse" });
    const keyboard = makeProduct({ id: "p2", name: "Mechanical Keyboard" });

    expect(productNameFor([mouse, keyboard], "p2")).toBe("Mechanical Keyboard");
  });

  it("returns null when no product matches the id", () => {
    const mouse = makeProduct({ id: "p1" });

    expect(productNameFor([mouse], "missing-id")).toBeNull();
  });

  it("returns null for an empty id (the '— Not tracked —' option)", () => {
    const mouse = makeProduct({ id: "p1" });

    expect(productNameFor([mouse], "")).toBeNull();
  });
});
