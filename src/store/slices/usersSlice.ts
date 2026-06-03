import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile } from "@/types";

interface UsersState {
  items: Profile[];
  loaded: boolean;
}

const initialState: UsersState = {
  items: [],
  loaded: false,
};

export const usersSlice = createSlice({
  name: "users",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<Profile[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    addUser(state, action: PayloadAction<Profile>) {
      state.items.push(action.payload);
    },
    updateUserRole(
      state,
      action: PayloadAction<{ id: string; role: Profile["role"] }>
    ) {
      const user = state.items.find((u) => u.id === action.payload.id);
      if (user) user.role = action.payload.role;
    },
  },
});

export const { hydrate: hydrateUsers, addUser, updateUserRole } = usersSlice.actions;
