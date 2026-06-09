import { purchasesSlice, hydratePurchases, addPurchase, updatePurchase, removePurchase } from "./purchasesSlice";
import type { Purchase } from "@/types";

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
  ...overrides,
});

describe("purchasesSlice", () => {
  const { reducer } = purchasesSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates purchases", () => {
    const purchases = [makePurchase()];
    const state = reducer(undefined, hydratePurchases(purchases));
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new purchase via addPurchase", () => {
    const initial = reducer(undefined, hydratePurchases([makePurchase()]));
    const newPurchase = makePurchase({ id: "purchase-new" });
    const state = reducer(initial, addPurchase(newPurchase));
    expect(state.items[0].id).toBe("purchase-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing purchase", () => {
    const initial = reducer(undefined, hydratePurchases([makePurchase()]));
    const updated = makePurchase({ product_name: "Updated Cable" });
    const state = reducer(initial, updatePurchase(updated));
    expect(state.items[0].product_name).toBe("Updated Cable");
  });

  it("removes a purchase by id", () => {
    const initial = reducer(
      undefined,
      hydratePurchases([makePurchase({ id: "p1" }), makePurchase({ id: "p2" })])
    );
    const state = reducer(initial, removePurchase("p1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("p2");
  });
});
