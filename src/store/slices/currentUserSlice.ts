import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile, TenantPlan } from "@/types";

interface CurrentUserState {
  profile: Profile | null;
  tenantPlan: TenantPlan | null;
  /** Platform-admin AI visibility switch (control.tenants.ai_enabled).
   * False until hydrated, so AI controls never flash before we know. */
  aiEnabled: boolean;
}

const initialState: CurrentUserState = {
  profile: null,
  tenantPlan: null,
  aiEnabled: false,
};

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
    setAiEnabled(state, action: PayloadAction<boolean>) {
      state.aiEnabled = action.payload;
    },
  },
});

export const { setCurrentUser, setTenantPlan, setAiEnabled } = currentUserSlice.actions;
