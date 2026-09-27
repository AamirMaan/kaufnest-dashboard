import { buyerLabel, initials, platformLabel } from "./recentOrderDisplay";

describe("initials", () => {
  it("uses first + last word initials", () => {
    expect(initials("Jane Doe")).toBe("JD");
    expect(initials("  maria de la cruz ")).toBe("MC");
  });
  it("uses the first two letters of a single word", () => {
    expect(initials("eBay")).toBe("EB");
  });
  it("falls back to ? for blank input", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("platformLabel", () => {
  it("uses brand casing for known platforms and capitalises unknown ones", () => {
    expect(platformLabel("ebay")).toBe("eBay");
    expect(platformLabel("kaufland")).toBe("Kaufland");
  });
});

describe("buyerLabel", () => {
  it("prefers the buyer name, else the platform label", () => {
    expect(buyerLabel({ buyer_name: " Jane Doe ", platform: "ebay" })).toBe("Jane Doe");
    expect(buyerLabel({ buyer_name: null, platform: "amazon" })).toBe("Amazon");
    expect(buyerLabel({ buyer_name: "", platform: "ebay" })).toBe("eBay");
  });
});
