import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile, TenantPlan } from "@/types";

interface CurrentUserState {
  profile: Profile | null;
  tenantPlan: TenantPlan | null;
  /** Platform-admin AI visibility switch (control.tenants.ai_enabled).
   * False until hydrated, so AI controls never flash before we know. */
  aiEnabled: boolean;
  /** Platform-admin per-tenant switch for EasyPost shipping-label
   * purchasing (control.tenants.shipping_labels_enabled). False until
   * hydrated — the order-detail page falls back to a plain PDF label
   * while this is false, so nothing needs to "flash" here the way AI
   * controls do, but the same fail-closed default is kept for consistency. */
  shippingLabelsEnabled: boolean;
}

const initialState: CurrentUserState = {
  profile: null,
  tenantPlan: null,
  aiEnabled: false,
  shippingLabelsEnabled: false,
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
    setShippingLabelsEnabled(state, action: PayloadAction<boolean>) {
      state.shippingLabelsEnabled = action.payload;
    },
  },
});

export const { setCurrentUser, setTenantPlan, setAiEnabled, setShippingLabelsEnabled } = currentUserSlice.actions;
