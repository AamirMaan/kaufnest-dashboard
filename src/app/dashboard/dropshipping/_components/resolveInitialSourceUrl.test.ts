import { resolveInitialSourceUrl } from "./resolveInitialSourceUrl";
import type { DropshipListing } from "@/types";

function makeListing(overrides: Partial<DropshipListing> = {}): DropshipListing {
  return {
    id: "1",
    ebay_listing_id: "ebay-1",
    title: "Test listing",
    image_url: null,
    ebay_url: "https://ebay.com/itm/1",
    current_price: 9.99,
    currency: "EUR",
    sku: null,
    source_url: null,
    source_platform: null,
    supplier_price: null,
    supplier_currency: null,
    supplier_price_checked_at: null,
    last_synced_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveInitialSourceUrl", () => {
  it("returns an empty string when there is no listing", () => {
    expect(resolveInitialSourceUrl(null)).toBe("");
  });

  it("prefers an explicitly linked source_url over a derivable SKU", () => {
    const listing = makeListing({
      source_url: "https://www.amazon.de/dp/B08N5WRWNW",
      sku: "1005006994518770",
    });
    expect(resolveInitialSourceUrl(listing)).toBe("https://www.amazon.de/dp/B08N5WRWNW");
  });

  it("derives the AliExpress URL from a numeric SKU when unlinked", () => {
    const listing = makeListing({ sku: "1005006994518770" });
    expect(resolveInitialSourceUrl(listing)).toBe(
      "https://de.aliexpress.com/item/1005006994518770.html"
    );
  });

  it("returns an empty string when unlinked and the SKU doesn't look like an item ID", () => {
    expect(resolveInitialSourceUrl(makeListing({ sku: "CUSTOM-LABEL" }))).toBe("");
    expect(resolveInitialSourceUrl(makeListing({ sku: null }))).toBe("");
  });
});
