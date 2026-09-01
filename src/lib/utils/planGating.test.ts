import { hasMessagingAndListings, hasPlatformIntegrations, canAddUser, getAiGenerationLimit, hasAiFeatures } from "./planGating";

describe("hasMessagingAndListings", () => {
  it("is true for business and for trial (trial mirrors business)", () => {
    expect(hasMessagingAndListings("business")).toBe(true);
    expect(hasMessagingAndListings("trial")).toBe(true);
  });

  it("is false for pro and starter", () => {
    expect(hasMessagingAndListings("pro")).toBe(false);
    expect(hasMessagingAndListings("starter")).toBe(false);
  });
});

describe("hasPlatformIntegrations", () => {
  it("is true for trial, pro and business", () => {
    expect(hasPlatformIntegrations("trial")).toBe(true);
    expect(hasPlatformIntegrations("pro")).toBe(true);
    expect(hasPlatformIntegrations("business")).toBe(true);
  });

  it("is false for starter", () => {
    expect(hasPlatformIntegrations("starter")).toBe(false);
  });
});

describe("canAddUser", () => {
  it("caps starter at 3 users", () => {
    expect(canAddUser("starter", 2)).toBe(true);
    expect(canAddUser("starter", 3)).toBe(false);
  });

  it("caps pro at 5 users", () => {
    expect(canAddUser("pro", 4)).toBe(true);
    expect(canAddUser("pro", 5)).toBe(false);
  });

  it("never caps business or trial", () => {
    expect(canAddUser("business", 9999)).toBe(true);
    expect(canAddUser("trial", 9999)).toBe(true);
  });
});

describe("getAiGenerationLimit", () => {
  it("gives business and trial the full monthly allowance", () => {
    expect(getAiGenerationLimit("business")).toBe(300);
    expect(getAiGenerationLimit("trial")).toBe(300);
  });

  it("gives plans without the AI feature no allowance at all", () => {
    expect(getAiGenerationLimit("starter")).toBe(0);
    expect(getAiGenerationLimit("pro")).toBe(0);
  });

  it("never grants an allowance to a plan that fails the feature gate", () => {
    for (const plan of ["trial", "starter", "pro", "business"] as const) {
      if (!hasAiFeatures(plan)) expect(getAiGenerationLimit(plan)).toBe(0);
    }
  });
});
