import {
  expensesSlice,
  hydratePage,
  addExpense,
  updateExpense,
  removeExpense,
  setFetching,
} from "./expensesSlice";
import type { Expense } from "@/types";
import { DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "expense-1",
  title: "Office Supplies",
  amount: 29.99,
  currency: "EUR",
  category: "office",
  vendor: "Staples",
  date: "2026-06-01",
  description: null,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  vat_rate: null,
  vat_amount: null,
  vendor_vat_number: null,
  invoice_number: null,
  ...overrides,
});

describe("expensesSlice", () => {
  const { reducer } = expensesSlice;

  it("starts empty with loaded=false", () => {
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
    const expenses = [makeExpense(), makeExpense({ id: "expense-2" })];
    const state = reducer(
      undefined,
      hydratePage({ data: expenses, count: 120, page: 2, pageSize: 50 })
    );
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(120);
    expect(state.isFetching).toBe(false);
  });

  it("hydratePage page 1 works correctly", () => {
    const expenses = [makeExpense()];
    const state = reducer(
      undefined,
      hydratePage({ data: expenses, count: 1, page: 1, pageSize: 50 })
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

  it("prepends a new expense via addExpense and increments total", () => {
    const existing = makeExpense({ id: "expense-old" });
    const initial = reducer(
      undefined,
      hydratePage({ data: [existing], count: 1, page: 1, pageSize: 50 })
    );
    const newExpense = makeExpense({ id: "expense-new", title: "New Expense" });
    const state = reducer(initial, addExpense(newExpense));
    expect(state.items[0].id).toBe("expense-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("addExpense increments total correctly from non-zero baseline", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeExpense({ id: "a" }), makeExpense({ id: "b" })], count: 10, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, addExpense(makeExpense({ id: "c" })));
    expect(state.total).toBe(11);
  });

  it("updates an existing expense in place", () => {
    const expense = makeExpense();
    const initial = reducer(
      undefined,
      hydratePage({ data: [expense], count: 1, page: 1, pageSize: 50 })
    );
    const updated = makeExpense({ title: "Updated Title" });
    const state = reducer(initial, updateExpense(updated));
    expect(state.items[0].title).toBe("Updated Title");
  });

  it("does nothing on updateExpense when id not found", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeExpense()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, updateExpense(makeExpense({ id: "missing" })));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("expense-1");
  });

  it("removes an expense by id and decrements total", () => {
    const expenses = [makeExpense({ id: "a" }), makeExpense({ id: "b" })];
    const initial = reducer(
      undefined,
      hydratePage({ data: expenses, count: 5, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, removeExpense("a"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("b");
    expect(state.total).toBe(4);
  });

  it("does nothing on removeExpense when id not found — total unchanged", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeExpense()], count: 3, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, removeExpense("nonexistent"));
    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(3);
  });
});
