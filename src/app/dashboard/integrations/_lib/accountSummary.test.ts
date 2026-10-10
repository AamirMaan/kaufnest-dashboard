import { platformHeading, needsReconnectBanner } from "./accountSummary";
import type { PlatformConnection } from "@/types";

describe("platformHeading", () => {
  it("shows used/cap on capped plans", () => {
    expect(platformHeading("eBay", 1, 2)).toBe("eBay — 1 of 2 accounts");
  });
  it("shows a plain count when unlimited", () => {
    expect(platformHeading("Amazon", 3, Infinity)).toBe("Amazon — 3 accounts");
    expect(platformHeading("Amazon", 1, Infinity)).toBe("Amazon — 1 account");
  });
});

describe("needsReconnectBanner", () => {
  const base = { platform: "ebay", status: "connected", external_account_id: null } as PlatformConnection;
  it("is true for a connected legacy eBay row without an account id", () => {
    expect(needsReconnectBanner([base])).toBe(true);
  });
  it("is false once the id is known, for Amazon, or when disconnected", () => {
    expect(needsReconnectBanner([{ ...base, external_account_id: "u-1" }])).toBe(false);
    expect(needsReconnectBanner([{ ...base, platform: "amazon" }])).toBe(false);
    expect(needsReconnectBanner([{ ...base, status: "disconnected" }])).toBe(false);
  });
});
