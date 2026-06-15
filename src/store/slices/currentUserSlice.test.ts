import { currentUserSlice, setCurrentUser, setTenantPlan } from "./currentUserSlice";
import type { Profile } from "@/types";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "user-1",
  email: "admin@acme.example",
  full_name: "Admin User",
  role: "admin",
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
