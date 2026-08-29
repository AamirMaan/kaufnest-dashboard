import { hasMessagingAndListings, hasPlatformIntegrations, canAddUser } from "./planGating";

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
