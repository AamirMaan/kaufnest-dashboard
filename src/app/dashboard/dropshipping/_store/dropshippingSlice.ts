import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DropshipListing, SourcePlatform } from "@/types";

interface DropshippingState {
  listings: DropshipListing[];
}

const initialState: DropshippingState = { listings: [] };

export const dropshippingSlice = createSlice({
  name: "dropshipping",
  initialState,
  reducers: {
    hydrateListings(state, action: PayloadAction<DropshipListing[]>) {
      state.listings = action.payload;
    },
    upsertListings(state, action: PayloadAction<DropshipListing[]>) {
      for (const incoming of action.payload) {
        const index = state.listings.findIndex(
          (l) => l.ebay_listing_id === incoming.ebay_listing_id
        );
        if (index >= 0) {
          // Preserve source_url and source_platform — refresh must not overwrite supplier links
          state.listings[index] = {
            ...incoming,
            source_url: state.listings[index].source_url,
            source_platform: state.listings[index].source_platform,
          };
        } else {
          state.listings.push(incoming);
        }
      }
    },
    updateListingSource(
      state,
      action: PayloadAction<{ id: string; sourceUrl: string | null; sourcePlatform: SourcePlatform | null }>
    ) {
      const listing = state.listings.find((l) => l.id === action.payload.id);
      if (listing) {
        listing.source_url = action.payload.sourceUrl;
        listing.source_platform = action.payload.sourcePlatform;
      }
    },
  },
});

export const { hydrateListings, upsertListings, updateListingSource } =
  dropshippingSlice.actions;
