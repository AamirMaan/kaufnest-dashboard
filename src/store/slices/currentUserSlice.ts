import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile } from "@/types";

interface CurrentUserState {
  profile: Profile | null;
}

const initialState: CurrentUserState = { profile: null };

export const currentUserSlice = createSlice({
  name: "currentUser",
  initialState,
  reducers: {
    setCurrentUser(state, action: PayloadAction<Profile>) {
      state.profile = action.payload;
    },
  },
});

export const { setCurrentUser } = currentUserSlice.actions;
