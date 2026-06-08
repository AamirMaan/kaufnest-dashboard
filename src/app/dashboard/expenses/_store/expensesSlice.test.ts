import { expensesSlice, hydrateExpenses, addExpense, updateExpense, removeExpense } from "./expensesSlice";
import type { Expense } from "@/types";

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
  ...overrides,
});

describe("expensesSlice", () => {
  const { reducer } = expensesSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates expenses", () => {
    const expenses = [makeExpense(), makeExpense({ id: "expense-2" })];
    const state = reducer(undefined, hydrateExpenses(expenses));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new expense via addExpense", () => {
    const initial = reducer(undefined, hydrateExpenses([makeExpense()]));
    const newExpense = makeExpense({ id: "expense-new", title: "New Expense" });
    const state = reducer(initial, addExpense(newExpense));
    expect(state.items[0].id).toBe("expense-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing expense", () => {
    const initial = reducer(undefined, hydrateExpenses([makeExpense()]));
    const updated = makeExpense({ title: "Updated Title" });
    const state = reducer(initial, updateExpense(updated));
    expect(state.items[0].title).toBe("Updated Title");
  });

  it("removes an expense by id", () => {
    const initial = reducer(
      undefined,
      hydrateExpenses([makeExpense({ id: "e1" }), makeExpense({ id: "e2" })])
    );
    const state = reducer(initial, removeExpense("e1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("e2");
  });
});
