import { companyProfileSlice, hydrateCompanyProfile } from "./companyProfileSlice";
import type { CompanyProfile } from "@/types";

const makeProfile = (overrides: Partial<CompanyProfile> = {}): CompanyProfile => ({
  id: "profile-1",
  name: "Acme GmbH",
  logo_url: null,
  vat_number: "DE123456789",
  address: "Main St 1, Berlin",
  currency: "EUR",
  timezone: "Europe/Berlin",
  updated_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

describe("companyProfileSlice", () => {
  const { reducer } = companyProfileSlice;

  it("starts with no profile", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.profile).toBeNull();
  });

  it("hydrates the company profile", () => {
    const profile = makeProfile();
    const state = reducer(undefined, hydrateCompanyProfile(profile));
    expect(state.profile).toEqual(profile);
  });

  it("replaces an existing profile on re-hydration", () => {
    const initial = reducer(undefined, hydrateCompanyProfile(makeProfile()));
    const updated = makeProfile({ name: "Acme International", currency: "USD" });
    const state = reducer(initial, hydrateCompanyProfile(updated));
    expect(state.profile).toEqual(updated);
  });
});
