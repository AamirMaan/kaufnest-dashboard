import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlatformPayout } from "@/types";

interface PlatformPayoutsState {
  items: PlatformPayout[];
}

const initialState: PlatformPayoutsState = { items: [] };

const platformPayoutsSlice = createSlice({
  name: "platformPayouts",
  initialState,
  reducers: {
    hydratePayouts(state, action: PayloadAction<PlatformPayout[]>) {
      state.items = action.payload;
    },
    addPayout(state, action: PayloadAction<PlatformPayout>) {
      state.items.unshift(action.payload);
    },
    deletePayout(state, action: PayloadAction<string>) {
      state.items = state.items.filter((p) => p.id !== action.payload);
    },
  },
});

export const { hydratePayouts, addPayout, deletePayout } = platformPayoutsSlice.actions;
export { platformPayoutsSlice };
export default platformPayoutsSlice.reducer;
