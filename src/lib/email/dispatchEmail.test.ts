import { buildDispatchEmail, escapeHtml, type DispatchEmailInput } from "./dispatchEmail";

const base: DispatchEmailInput = {
  saleId: "sale-1",
  productName: "Blue Mug",
  quantity: 2,
  platform: "ebay",
  marketplace: "ebay.de",
  externalOrderId: "12-34:56",
  orderDate: "2026-10-19",
  buyerName: "Jane Buyer",
  address: ["Main St 1", null, "10115 Berlin", "DE"],
  locationName: "Berlin Warehouse",
  recipientName: "Sam",
  appUrl: "https://app.boughtopia.com/",
};

describe("buildDispatchEmail", () => {
  it("builds subject, text and html with the order link", () => {
    const m = buildDispatchEmail(base);
    expect(m.subject).toBe("Dispatch needed: 2 × Blue Mug (Berlin Warehouse)");
    expect(m.text).toContain("Hi Sam,");
    expect(m.text).toContain("https://app.boughtopia.com/dashboard/sales/sale-1");
    expect(m.text).toContain("Main St 1");
    expect(m.text).not.toContain("null");
    expect(m.html).toContain('href="https://app.boughtopia.com/dashboard/sales/sale-1"');
  });

  it("escapes hostile values in html", () => {
    const m = buildDispatchEmail({ ...base, productName: '<script>alert("x")</script>', buyerName: "A & B" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A &amp; B");
  });

  it("falls back when optional fields are missing", () => {
    const m = buildDispatchEmail({ ...base, recipientName: null, buyerName: null, address: [], marketplace: null, externalOrderId: null });
    expect(m.text).toContain("Hi,");
    expect(m.text).not.toContain("Ship to");
  });
});

describe("escapeHtml", () => {
  it("escapes the five html-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
