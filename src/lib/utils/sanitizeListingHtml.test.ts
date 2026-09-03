import { sanitizeListingHtml } from "./sanitizeListingHtml";

describe("sanitizeListingHtml", () => {
  it("keeps the formatting eBay allows", () => {
    const html = "<p>A <strong>great</strong> <em>mouse</em></p><ul><li>USB-C</li></ul>";
    expect(sanitizeListingHtml(html)).toBe(html);
  });

  it("strips script tags — eBay blocks active content", () => {
    const out = sanitizeListingHtml('<p>Hi</p><script>alert("x")</script>');
    expect(out).not.toContain("script");
    expect(out).toContain("<p>Hi</p>");
  });

  it("strips inline event handlers", () => {
    expect(sanitizeListingHtml('<p onclick="steal()">Hi</p>')).not.toContain("onclick");
  });

  it("strips iframes and forms", () => {
    const out = sanitizeListingHtml("<iframe src='x'></iframe><form><input/></form><p>ok</p>");
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("form");
    expect(out).toContain("<p>ok</p>");
  });

  it("strips javascript: URLs from links", () => {
    expect(sanitizeListingHtml('<a href="javascript:evil()">x</a>')).not.toContain("javascript:");
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeListingHtml("")).toBe("");
  });

  it("escapes a plain-text description rather than dropping it", () => {
    expect(sanitizeListingHtml("Just plain text")).toContain("Just plain text");
  });
});
