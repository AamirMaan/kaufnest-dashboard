import { normalizeMarketplace, marketplaceLabel, UNKNOWN_MARKETPLACE } from "./marketplace";

describe("normalizeMarketplace", () => {
  it.each([
    ["Amazon.de", "amazon.de"],
    ["  amazon.DE ", "amazon.de"],
    ["amazon.co.uk", "amazon.co.uk"],
    ["www.amazon.fr", "amazon.fr"],
    ["EBAY_DE", "ebay.de"],
    ["ebay_fr", "ebay.fr"],
    ["EBAY_GB", "ebay.co.uk"],
    ["EBAY_US", "ebay.com"],
    ["EBAY_AU", "ebay.com.au"],
    ["EBAY_MOTORS_US", "ebay.com"],
    ["EBAY_HK", "ebay.com.hk"],
    ["EBAY_SG", "ebay.com.sg"],
    ["EBAY_MY", "ebay.com.my"],
    ["ebay.de", "ebay.de"],
    ["Etsy.com", "etsy.com"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMarketplace(raw)).toBe(expected);
  });

  it.each(["amazon", "Amazon", "ebay", "EBAY", "", "   "])("%p carries no market → null", (raw) => {
    expect(normalizeMarketplace(raw)).toBeNull();
  });

  it("null/undefined → null", () => {
    expect(normalizeMarketplace(null)).toBeNull();
    expect(normalizeMarketplace(undefined)).toBeNull();
  });
});

describe("marketplaceLabel", () => {
  it("labels null/empty as Unknown", () => {
    expect(marketplaceLabel(null)).toBe("Unknown");
    expect(marketplaceLabel("")).toBe("Unknown");
  });
  it("returns the stored value otherwise", () => {
    expect(marketplaceLabel("amazon.de")).toBe("amazon.de");
  });
  it("exports the filter sentinel", () => {
    expect(UNKNOWN_MARKETPLACE).toBe("__unknown__");
  });
});
