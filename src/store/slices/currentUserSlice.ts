import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile, TenantPlan } from "@/types";
import type { AccessMap } from "@/lib/permissions/sections";
import type { PlanEntitlements, PlanFeature } from "@/lib/plans/entitlements";

interface CurrentUserState {
  profile: Profile | null;
  tenantPlan: TenantPlan | null;
  /** From control.plans via dashboard/layout.tsx; null until hydrated — every gate treats null as 'not entitled'. */
  planEntitlements: PlanEntitlements | null;
  /** From control.plans via dashboard/layout.tsx; null until hydrated — every gate treats null as 'not entitled'.
   * Names of the PUBLIC paid plans including each feature, for upgrade copy (`usePlan().availability`). */
  planNamesByFeature: Record<PlanFeature, string[]> | null;
  /** Platform-admin AI visibility switch (control.tenants.ai_enabled).
   * False until hydrated, so AI controls never flash before we know. */
  aiEnabled: boolean;
  /** Platform-admin per-tenant switch for EasyPost shipping-label
   * purchasing (control.tenants.shipping_labels_enabled). False until
   * hydrated — the order-detail page falls back to a plain PDF label
   * while this is false, so nothing needs to "flash" here the way AI
   * controls do, but the same fail-closed default is kept for consistency. */
  shippingLabelsEnabled: boolean;
  /**
   * Section access from get_my_access() (055) — role defaults + per-user
   * exceptions, UNCAPPED by plan (Task 5 review, fix round 1, 2026-09-30:
   * previously had the plan ceiling applied here; moved to `useAccess()`
   * instead, which applies it only to the `can()`/button-gating result, not
   * to the raw stored map). Null until hydrated. Read via `useAccess()`
   * (`src/store/useAccess.ts`), never this field directly — `useAccess()`
   * exposes both the plan-capped `access`/`can()` (for actions) and the
   * uncapped `canSee()` (for nav/route visibility, so a role/exception
   * grant to a plan-gated section like Integrations still shows the nav
   * link and lets the page render its own upgrade screen). */
  access: AccessMap | null;
}

const initialState: CurrentUserState = {
  profile: null,
  tenantPlan: null,
  planEntitlements: null,
  planNamesByFeature: null,
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
    setPlanEntitlements(state, action: PayloadAction<PlanEntitlements>) {
      state.planEntitlements = action.payload;
    },
    setPlanNamesByFeature(state, action: PayloadAction<Record<PlanFeature, string[]>>) {
      state.planNamesByFeature = action.payload;
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

export const {
  setCurrentUser,
  setTenantPlan,
  setPlanEntitlements,
  setPlanNamesByFeature,
  setAiEnabled,
  setShippingLabelsEnabled,
  setAccess,
} = currentUserSlice.actions;
