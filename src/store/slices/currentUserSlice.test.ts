import {
  currentUserSlice,
  setCurrentUser,
  setTenantPlan,
  setAiEnabled,
  setShippingLabelsEnabled,
  setAccess,
  setPlanEntitlements,
  setPlanNamesByFeature,
} from "./currentUserSlice";
import { NO_ENTITLEMENTS } from "@/lib/plans/entitlements";
import { ROLE_DEFAULTS } from "@/lib/permissions/sections";
import type { Profile } from "@/types";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "user-1",
  email: "admin@acme.example",
  full_name: "Admin User",
  role: "admin",
  permission_overrides: [],
  status: "active",
  notifications_read_through: null,
  created_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

describe("currentUserSlice", () => {
  const { reducer } = currentUserSlice;

  it("starts with no profile and no tenant plan", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.profile).toBeNull();
    expect(state.tenantPlan).toBeNull();
  });

  it("sets the current user profile", () => {
    const profile = makeProfile();
    const state = reducer(undefined, setCurrentUser(profile));
    expect(state.profile).toEqual(profile);
  });

  it("sets the tenant plan", () => {
    const state = reducer(undefined, setTenantPlan("pro"));
    expect(state.tenantPlan).toBe("pro");
  });

  it("keeps the profile when the tenant plan is set", () => {
    const withProfile = reducer(undefined, setCurrentUser(makeProfile()));
    const state = reducer(withProfile, setTenantPlan("business"));
    expect(state.profile).toEqual(makeProfile());
    expect(state.tenantPlan).toBe("business");
  });
});

describe("setAiEnabled", () => {
  it("defaults to false before hydration", () => {
    const state = currentUserSlice.reducer(undefined, { type: "@@INIT" });
    expect(state.aiEnabled).toBe(false);
  });

  it("stores the tenant's AI visibility flag", () => {
    const state = currentUserSlice.reducer(undefined, setAiEnabled(true));
    expect(state.aiEnabled).toBe(true);
  });

  it("can revoke a previously enabled flag", () => {
    const enabled = currentUserSlice.reducer(undefined, setAiEnabled(true));
    const revoked = currentUserSlice.reducer(enabled, setAiEnabled(false));
    expect(revoked.aiEnabled).toBe(false);
  });
});

describe("setShippingLabelsEnabled", () => {
  it("defaults to false before hydration", () => {
    const state = currentUserSlice.reducer(undefined, { type: "@@INIT" });
    expect(state.shippingLabelsEnabled).toBe(false);
  });

  it("stores the tenant's shipping-label visibility flag", () => {
    const state = currentUserSlice.reducer(undefined, setShippingLabelsEnabled(true));
    expect(state.shippingLabelsEnabled).toBe(true);
  });

  it("can revoke a previously enabled flag", () => {
    const enabled = currentUserSlice.reducer(undefined, setShippingLabelsEnabled(true));
    const revoked = currentUserSlice.reducer(enabled, setShippingLabelsEnabled(false));
    expect(revoked.shippingLabelsEnabled).toBe(false);
  });
});

describe("currentUserSlice access", () => {
  it("starts null and stores the hydrated map", () => {
    const init = currentUserSlice.reducer(undefined, { type: "@@init" });
    expect(init.access).toBeNull();
    const next = currentUserSlice.reducer(init, setAccess({ ...ROLE_DEFAULTS.accountant, orders: 0 }));
    expect(next.access?.orders).toBe(0);
  });
});

describe("currentUserSlice plan entitlements", () => {
  const { reducer } = currentUserSlice;

  it("starts with no plan entitlements or plan names", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.planEntitlements).toBeNull();
    expect(state.planNamesByFeature).toBeNull();
  });

  it("stores plan entitlements and plan names", () => {
    const names = { platformIntegrations: ["Pro"], aiFeatures: [], messagingAndListings: [], advancedInventory: [] };
    let state = reducer(undefined, setPlanEntitlements(NO_ENTITLEMENTS));
    state = reducer(state, setPlanNamesByFeature(names));
    expect(state.planEntitlements).toEqual(NO_ENTITLEMENTS);
    expect(state.planNamesByFeature).toEqual(names);
  });
});
