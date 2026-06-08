import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Expense } from "@/types";

interface ExpensesState {
  items: Expense[];
  loaded: boolean;
}

const initialState: ExpensesState = {
  items: [],
  loaded: false,
};

export const expensesSlice = createSlice({
  name: "expenses",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<Expense[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    addExpense(state, action: PayloadAction<Expense>) {
      state.items.unshift(action.payload);
    },
    updateExpense(state, action: PayloadAction<Expense>) {
      const idx = state.items.findIndex((e) => e.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removeExpense(state, action: PayloadAction<string>) {
      state.items = state.items.filter((e) => e.id !== action.payload);
    },
  },
});

export const {
  hydrate: hydrateExpenses,
  addExpense,
  updateExpense,
  removeExpense,
} = expensesSlice.actions;
