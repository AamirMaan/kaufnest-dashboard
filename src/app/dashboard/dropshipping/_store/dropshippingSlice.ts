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
          // Preserve supplier link, price snapshot, and customs fee — refresh must not overwrite them
          state.listings[index] = {
            ...incoming,
            source_url: state.listings[index].source_url,
            source_platform: state.listings[index].source_platform,
            supplier_price: state.listings[index].supplier_price,
            supplier_currency: state.listings[index].supplier_currency,
            supplier_price_checked_at: state.listings[index].supplier_price_checked_at,
            customs_tax_amount: state.listings[index].customs_tax_amount,
          };
        } else {
          state.listings.push(incoming);
        }
      }
    },
    updateSupplierPrices(
      state,
      action: PayloadAction<
        Array<{
          id: string;
          supplier_price: number;
          supplier_currency: string;
          supplier_price_checked_at: string;
          source_url?: string;
          source_platform?: SourcePlatform;
        }>
      >
    ) {
      for (const update of action.payload) {
        const listing = state.listings.find((l) => l.id === update.id);
        if (!listing) continue;
        listing.supplier_price = update.supplier_price;
        listing.supplier_currency = update.supplier_currency;
        listing.supplier_price_checked_at = update.supplier_price_checked_at;
        // customs_tax_amount is a flat, independently-set fee — a price
        // refresh must not touch it.
        // The API derives+persists source_url from a numeric SKU on first check
        if (update.source_url && !listing.source_url) {
          listing.source_url = update.source_url;
          listing.source_platform = update.source_platform ?? "aliexpress";
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
    updateCustomsTax(
      state,
      action: PayloadAction<{ id: string; customsTaxAmount: number }>
    ) {
      const listing = state.listings.find((l) => l.id === action.payload.id);
      if (listing) {
        listing.customs_tax_amount = action.payload.customsTaxAmount;
      }
    },
  },
});

export const { hydrateListings, upsertListings, updateSupplierPrices, updateListingSource, updateCustomsTax } =
  dropshippingSlice.actions;
