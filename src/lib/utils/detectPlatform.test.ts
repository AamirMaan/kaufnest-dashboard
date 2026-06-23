import { detectPlatform } from "./detectPlatform";

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
