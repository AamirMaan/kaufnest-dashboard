import { detectPlatform, isAliExpressSku, aliExpressUrlFromSku } from "./detectPlatform";

describe("detectPlatform", () => {
  it("detects amazon.com", () => {
    expect(detectPlatform("https://www.amazon.com/dp/B08N5WRWNW")).toBe("amazon");
  });

  it("detects amazon.de", () => {
    expect(detectPlatform("https://www.amazon.de/dp/B08N5WRWNW")).toBe("amazon");
  });

  it("detects amazon.co.uk", () => {
    expect(detectPlatform("https://www.amazon.co.uk/dp/B08N5WRWNW")).toBe("amazon");
  });

  it("detects aliexpress.com", () => {
    expect(detectPlatform("https://www.aliexpress.com/item/1005006123456789.html")).toBe("aliexpress");
  });

  it("returns null for unknown domain", () => {
    expect(detectPlatform("https://www.example.com/product/123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectPlatform("")).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(detectPlatform("not-a-url")).toBeNull();
  });

  it("returns null for partial URL without protocol", () => {
    expect(detectPlatform("amazon.com/product")).toBeNull();
  });
});

describe("isAliExpressSku", () => {
  it("accepts a 6-20 digit numeric SKU", () => {
    expect(isAliExpressSku("1005006994518770")).toBe(true);
    expect(isAliExpressSku("123456")).toBe(true);
  });

  it("rejects SKUs shorter than 6 digits", () => {
    expect(isAliExpressSku("12345")).toBe(false);
  });

  it("rejects SKUs longer than 20 digits", () => {
    expect(isAliExpressSku("123456789012345678901")).toBe(false);
  });

  it("rejects alphanumeric SKUs", () => {
    expect(isAliExpressSku("ABC123456")).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(isAliExpressSku(null)).toBe(false);
    expect(isAliExpressSku(undefined)).toBe(false);
    expect(isAliExpressSku("")).toBe(false);
  });
});

describe("aliExpressUrlFromSku", () => {
  it("builds the de.aliexpress.com item URL from a numeric SKU", () => {
    expect(aliExpressUrlFromSku("1005006994518770")).toBe(
      "https://de.aliexpress.com/item/1005006994518770.html"
    );
  });
});
