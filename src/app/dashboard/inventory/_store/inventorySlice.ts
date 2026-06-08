import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Product } from "@/types";

interface InventoryState {
  items: Product[];
  loaded: boolean;
}

const initialState: InventoryState = {
  items: [],
  loaded: false,
};

export const inventorySlice = createSlice({
  name: "inventory",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<Product[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    addProduct(state, action: PayloadAction<Product>) {
      state.items.unshift(action.payload);
    },
    updateProduct(state, action: PayloadAction<Product>) {
      const idx = state.items.findIndex((p) => p.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removeProduct(state, action: PayloadAction<string>) {
      state.items = state.items.filter((p) => p.id !== action.payload);
    },
  },
});

export const {
  hydrate: hydrateProducts,
  addProduct,
  updateProduct,
  removeProduct,
} = inventorySlice.actions;
