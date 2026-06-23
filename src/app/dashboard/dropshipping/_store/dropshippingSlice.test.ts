import { dropshippingSlice, hydrateListings, upsertListings, updateListingSource } from "./dropshippingSlice";
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
