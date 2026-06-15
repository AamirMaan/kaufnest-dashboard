import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile, TenantPlan } from "@/types";

interface CurrentUserState {
  profile: Profile | null;
  tenantPlan: TenantPlan | null;
}

const initialState: CurrentUserState = { profile: null, tenantPlan: null };

export const currentUserSlice = createSlice({
  name: "currentUser",
  initialState,
  reducers: {
    setCurrentUser(state, action: PayloadAction<Profile>) {
      state.profile = action.payload;
    },
    setTenantPlan(state, action: PayloadAction<TenantPlan>) {
      state.tenantPlan = action.payload;
    },
  },
});

export const { setCurrentUser, setTenantPlan } = currentUserSlice.actions;
