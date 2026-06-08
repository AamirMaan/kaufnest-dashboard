import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Purchase } from "@/types";

interface PurchasesState {
  items: Purchase[];
  loaded: boolean;
}

const initialState: PurchasesState = {
  items: [],
  loaded: false,
};

export const purchasesSlice = createSlice({
  name: "purchases",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<Purchase[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    addPurchase(state, action: PayloadAction<Purchase>) {
      state.items.unshift(action.payload);
    },
    updatePurchase(state, action: PayloadAction<Purchase>) {
      const idx = state.items.findIndex((p) => p.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removePurchase(state, action: PayloadAction<string>) {
      state.items = state.items.filter((p) => p.id !== action.payload);
    },
  },
});

export const {
  hydrate: hydratePurchases,
  addPurchase,
  updatePurchase,
  removePurchase,
} = purchasesSlice.actions;
