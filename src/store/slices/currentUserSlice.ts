import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile, TenantPlan } from "@/types";
import type { AccessMap } from "@/lib/permissions/sections";

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
  /** Section access from get_my_access() (055) with the plan ceiling applied; null until hydrated. */
  access: AccessMap | null;
}

const initialState: CurrentUserState = {
  profile: null,
  tenantPlan: null,
  aiEnabled: false,
  shippingLabelsEnabled: false,
  access: null,
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
    setAccess(state, action: PayloadAction<AccessMap>) {
      state.access = action.payload;
    },
  },
});

export const { setCurrentUser, setTenantPlan, setAiEnabled, setShippingLabelsEnabled, setAccess } = currentUserSlice.actions;
