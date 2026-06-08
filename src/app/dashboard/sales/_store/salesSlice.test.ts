import { salesSlice, hydrateSales, addSale, updateSale, removeSale } from "./salesSlice";
import type { Sale } from "@/types";

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
  ...overrides,
});

describe("salesSlice", () => {
  const { reducer } = salesSlice;

  it("starts with an empty items array and loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates items and sets loaded=true", () => {
    const sales = [makeSale(), makeSale({ id: "sale-2" })];
    const state = reducer(undefined, hydrateSales(sales));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new sale via addSale", () => {
    const existing = makeSale({ id: "sale-old" });
    const initial = reducer(undefined, hydrateSales([existing]));
    const newSale = makeSale({ id: "sale-new", product_name: "New Item" });
    const state = reducer(initial, addSale(newSale));
    expect(state.items[0].id).toBe("sale-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing sale in place", () => {
    const sale = makeSale();
    const initial = reducer(undefined, hydrateSales([sale]));
    const updated = makeSale({ product_name: "Updated Product" });
    const state = reducer(initial, updateSale(updated));
    expect(state.items[0].product_name).toBe("Updated Product");
  });

  it("does nothing on updateSale when id not found", () => {
    const initial = reducer(undefined, hydrateSales([makeSale()]));
    const state = reducer(initial, updateSale(makeSale({ id: "missing" })));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("sale-1");
  });

  it("removes a sale by id", () => {
    const sales = [makeSale({ id: "a" }), makeSale({ id: "b" })];
    const initial = reducer(undefined, hydrateSales(sales));
    const state = reducer(initial, removeSale("a"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("b");
  });

  it("does nothing on removeSale when id not found", () => {
    const initial = reducer(undefined, hydrateSales([makeSale()]));
    const state = reducer(initial, removeSale("nonexistent"));
    expect(state.items).toHaveLength(1);
  });
});
