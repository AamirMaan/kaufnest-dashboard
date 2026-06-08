import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Sale } from "@/types";

interface SalesState {
  items: Sale[];
  loaded: boolean;
}

const initialState: SalesState = {
  items: [],
  loaded: false,
};

export const salesSlice = createSlice({
  name: "sales",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<Sale[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    addSale(state, action: PayloadAction<Sale>) {
      state.items.unshift(action.payload);
    },
    updateSale(state, action: PayloadAction<Sale>) {
      const idx = state.items.findIndex((s) => s.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removeSale(state, action: PayloadAction<string>) {
      state.items = state.items.filter((s) => s.id !== action.payload);
    },
  },
});

export const { hydrate: hydrateSales, addSale, updateSale, removeSale } =
  salesSlice.actions;
