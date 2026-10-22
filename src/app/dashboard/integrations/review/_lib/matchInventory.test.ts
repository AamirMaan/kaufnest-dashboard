import { matchInventory } from "./matchInventory";

const products = [
  { id: "p1", name: "Wireless Mouse", sku: "MOUSE-1" },
  { id: "p2", name: "USB-C Cable", sku: null },
  { id: "p3", name: "Desk Lamp", sku: "LAMP" },
];

describe("matchInventory", () => {
  it("matches an exact SKU, ignoring case and whitespace", () => {
    expect(matchInventory({ sku: " mouse-1 ", product_name: "x" }, products)).toEqual({
      productId: "p1",
      reason: "sku",
    });
  });

  it("falls back to an exact normalised name", () => {
    expect(matchInventory({ sku: null, product_name: "  usb-c   CABLE " }, products)).toEqual({
      productId: "p2",
      reason: "name",
    });
  });

  it("prefers the SKU match over a name match", () => {
    expect(matchInventory({ sku: "LAMP", product_name: "Wireless Mouse" }, products)).toEqual({
      productId: "p3",
      reason: "sku",
    });
  });

  it("proposes nothing when the SKU is ambiguous", () => {
    const dup = [...products, { id: "p4", name: "Other", sku: "mouse-1" }];
    expect(matchInventory({ sku: "MOUSE-1", product_name: "zzz" }, dup)).toBeNull();
  });

  it("proposes nothing when the name is ambiguous", () => {
    const dup = [...products, { id: "p4", name: "usb-c cable", sku: null }];
    expect(matchInventory({ sku: null, product_name: "USB-C Cable" }, dup)).toBeNull();
  });

  it("proposes nothing when nothing matches", () => {
    expect(matchInventory({ sku: "NOPE", product_name: "Unknown" }, products)).toBeNull();
  });

  it("ignores empty SKUs on either side", () => {
    expect(matchInventory({ sku: "", product_name: "Unknown" }, [{ id: "a", name: "A", sku: "" }])).toBeNull();
  });
});
