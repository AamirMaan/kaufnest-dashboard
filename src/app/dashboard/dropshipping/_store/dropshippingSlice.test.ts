import {
  dropshippingSlice,
  hydrateListings,
  upsertListings,
  updateListingSource,
  updateSupplierPrices,
  updateCustomsTax,
} from "./dropshippingSlice";
import type { DropshipListing } from "@/types";

const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Test Listing",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 25.99,
  currency: "EUR",
  sku: "SKU-001",
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

const reducer = dropshippingSlice.reducer;

describe("dropshippingSlice", () => {
  it("hydrateListings replaces state with new array", () => {
    const state = { listings: [makeListing({ id: "old" })] };
    const newListings = [makeListing({ id: "new-1" }), makeListing({ id: "new-2", ebay_listing_id: "ebay-2" })];
    const result = reducer(state, hydrateListings(newListings));
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0].id).toBe("new-1");
  });

  it("upsertListings appends new listings", () => {
    const existing = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
    const state = { listings: [existing] };
    const newListing = makeListing({ id: "uuid-2", ebay_listing_id: "ebay-2" });
    const result = reducer(state, upsertListings([newListing]));
    expect(result.listings).toHaveLength(2);
  });

  it("upsertListings updates existing listing by ebay_listing_id without touching source_url", () => {
    const existing = makeListing({
      id: "uuid-1",
      ebay_listing_id: "ebay-1",
      title: "Old Title",
      source_url: "https://www.amazon.com/dp/OLD",
      source_platform: "amazon",
    });
    const state = { listings: [existing] };
    const updated = makeListing({
      id: "uuid-1",
      ebay_listing_id: "ebay-1",
      title: "New Title",
      source_url: null,     // refresh sends null — should be ignored
      source_platform: null, // same
    });
    const result = reducer(state, upsertListings([updated]));
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].title).toBe("New Title");
    expect(result.listings[0].source_url).toBe("https://www.amazon.com/dp/OLD");
    expect(result.listings[0].source_platform).toBe("amazon");
  });

  it("updateListingSource updates correct row by id; leaves other rows unchanged", () => {
    const listing1 = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
    const listing2 = makeListing({ id: "uuid-2", ebay_listing_id: "ebay-2" });
    const state = { listings: [listing1, listing2] };
    const result = reducer(
      state,
      updateListingSource({ id: "uuid-1", sourceUrl: "https://www.amazon.com/dp/NEW", sourcePlatform: "amazon" })
    );
    expect(result.listings[0].source_url).toBe("https://www.amazon.com/dp/NEW");
    expect(result.listings[0].source_platform).toBe("amazon");
    expect(result.listings[1].source_url).toBeNull();
  });

  it("upsertListings preserves supplier price snapshot on refresh", () => {
    const existing = makeListing({
      supplier_price: 4.99,
      supplier_currency: "EUR",
      supplier_price_checked_at: "2026-07-01T00:00:00Z",
    });
    const state = { listings: [existing] };
    const refreshed = makeListing({ title: "New Title" }); // supplier fields null
    const result = reducer(state, upsertListings([refreshed]));
    expect(result.listings[0].supplier_price).toBe(4.99);
    expect(result.listings[0].supplier_currency).toBe("EUR");
    expect(result.listings[0].supplier_price_checked_at).toBe("2026-07-01T00:00:00Z");
  });

  it("upsertListings preserves the customs fee on refresh", () => {
    const existing = makeListing({ customs_tax_amount: 8 });
    const state = { listings: [existing] };
    const refreshed = makeListing({ title: "New Title", customs_tax_amount: 3 }); // refresh's default, should be ignored
    const result = reducer(state, upsertListings([refreshed]));
    expect(result.listings[0].customs_tax_amount).toBe(8);
  });

  it("updateCustomsTax sets the fee on the matching listing", () => {
    const listing1 = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
    const listing2 = makeListing({ id: "uuid-2", ebay_listing_id: "ebay-2" });
    const state = { listings: [listing1, listing2] };
    const result = reducer(
      state,
      updateCustomsTax({ id: "uuid-1", customsTaxAmount: 5.5 })
    );
    expect(result.listings[0].customs_tax_amount).toBe(5.5);
    expect(result.listings[1].customs_tax_amount).toBe(3);
  });

  it("updateSupplierPrices does not touch the customs fee — it's independent of price", () => {
    const listing = makeListing({
      id: "uuid-1",
      ebay_listing_id: "ebay-1",
      customs_tax_amount: 8, // a custom, overridden fee
    });
    const state = { listings: [listing] };
    const result = reducer(
      state,
      updateSupplierPrices([
        {
          id: "uuid-1",
          supplier_price: 16,
          supplier_currency: "EUR",
          supplier_price_checked_at: "2026-07-10T00:00:00Z",
        },
      ])
    );
    expect(result.listings[0].supplier_price).toBe(16);
    expect(result.listings[0].customs_tax_amount).toBe(8);
  });

  it("updateSupplierPrices sets snapshot and derived source_url only when unset", () => {
    const unlinked = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
    const linked = makeListing({
      id: "uuid-2",
      ebay_listing_id: "ebay-2",
      source_url: "https://de.aliexpress.com/item/999.html",
      source_platform: "aliexpress",
    });
    const state = { listings: [unlinked, linked] };
    const result = reducer(
      state,
      updateSupplierPrices([
        {
          id: "uuid-1",
          supplier_price: 3.5,
          supplier_currency: "EUR",
          supplier_price_checked_at: "2026-07-10T00:00:00Z",
          source_url: "https://de.aliexpress.com/item/111.html",
          source_platform: "aliexpress",
        },
        {
          id: "uuid-2",
          supplier_price: 7.25,
          supplier_currency: "EUR",
          supplier_price_checked_at: "2026-07-10T00:00:00Z",
          source_url: "https://de.aliexpress.com/item/SHOULD-NOT-OVERWRITE.html",
          source_platform: "aliexpress",
        },
      ])
    );
    expect(result.listings[0].supplier_price).toBe(3.5);
    expect(result.listings[0].source_url).toBe("https://de.aliexpress.com/item/111.html");
    expect(result.listings[0].source_platform).toBe("aliexpress");
    expect(result.listings[1].supplier_price).toBe(7.25);
    expect(result.listings[1].source_url).toBe("https://de.aliexpress.com/item/999.html");
  });

  it("updateListingSource is a no-op if id not found", () => {
    const listing = makeListing({ id: "uuid-1" });
    const state = { listings: [listing] };
    const result = reducer(
      state,
      updateListingSource({ id: "uuid-999", sourceUrl: "https://www.amazon.com/dp/X", sourcePlatform: "amazon" })
    );
    expect(result.listings[0]).toEqual(listing);
  });
});
