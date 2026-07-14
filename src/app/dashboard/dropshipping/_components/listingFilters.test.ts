import { matchesMarginFilter, matchesListingSearch } from "./listingFilters";
import type { DropshipListing } from "@/types";

const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Wireless Charger",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 20,
  currency: "EUR",
  sku: "WC-001",
  source_url: null,
  source_platform: null,
  supplier_price: null,
  supplier_currency: null,
  supplier_price_checked_at: null,
  customs_tax_amount: 3,
  last_synced_at: "2026-06-23T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  ...overrides,
});

describe("matchesMarginFilter", () => {
  it("matches everything when band is 'all', including listings with no margin", () => {
    expect(matchesMarginFilter(makeListing(), "all")).toBe(true);
  });

  it("excludes a listing with no computed margin from any specific band", () => {
    const listing = makeListing({ supplier_price: null });
    expect(matchesMarginFilter(listing, "danger")).toBe(false);
    expect(matchesMarginFilter(listing, "warning")).toBe(false);
    expect(matchesMarginFilter(listing, "success")).toBe(false);
  });

  it("matches 'danger' for margin below 10%", () => {
    // effective_cost = 16 + 3 = 19; (20 - 19) / 20 * 100 = 5
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 16,
      supplier_currency: "EUR",
      customs_tax_amount: 3,
    });
    expect(matchesMarginFilter(listing, "danger")).toBe(true);
    expect(matchesMarginFilter(listing, "warning")).toBe(false);
    expect(matchesMarginFilter(listing, "success")).toBe(false);
  });

  it("matches 'warning' for margin between 10% and 25%", () => {
    // effective_cost = 14 + 3 = 17; (20 - 17) / 20 * 100 = 15
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 14,
      supplier_currency: "EUR",
      customs_tax_amount: 3,
    });
    expect(matchesMarginFilter(listing, "warning")).toBe(true);
    expect(matchesMarginFilter(listing, "danger")).toBe(false);
    expect(matchesMarginFilter(listing, "success")).toBe(false);
  });

  it("matches 'success' for margin at or above 25%", () => {
    // effective_cost = 10 + 3 = 13; (20 - 13) / 20 * 100 = 35
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 10,
      supplier_currency: "EUR",
      customs_tax_amount: 3,
    });
    expect(matchesMarginFilter(listing, "success")).toBe(true);
    expect(matchesMarginFilter(listing, "danger")).toBe(false);
    expect(matchesMarginFilter(listing, "warning")).toBe(false);
  });
});

describe("matchesListingSearch", () => {
  it("matches everything when the search term is empty or whitespace", () => {
    expect(matchesListingSearch(makeListing(), "")).toBe(true);
    expect(matchesListingSearch(makeListing(), "   ")).toBe(true);
  });

  it("matches on title, case-insensitively", () => {
    const listing = makeListing({ title: "Wireless Charger" });
    expect(matchesListingSearch(listing, "wireless")).toBe(true);
    expect(matchesListingSearch(listing, "CHARGER")).toBe(true);
    expect(matchesListingSearch(listing, "keyboard")).toBe(false);
  });

  it("matches on sku, case-insensitively", () => {
    const listing = makeListing({ sku: "WC-001" });
    expect(matchesListingSearch(listing, "wc-001")).toBe(true);
    expect(matchesListingSearch(listing, "xyz")).toBe(false);
  });

  it("does not crash when sku is null", () => {
    const listing = makeListing({ sku: null });
    expect(matchesListingSearch(listing, "wireless")).toBe(true);
    expect(matchesListingSearch(listing, "anything-else")).toBe(false);
  });
});
