import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { EbayListingDraft, ListingStatus } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

export type ListingStatusFilter = ListingStatus | "all";

interface ListingsState {
  items: EbayListingDraft[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
}

const initialState: ListingsState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
};

// ─── Thunk ────────────────────────────────────────────────────────────────────

export const fetchListingsPage = createAsyncThunk(
  "listings/fetchPage",
  async (params: { page: number; pageSize: number; status: ListingStatusFilter }) => {
    const { page, pageSize, status } = params;

    const supabase = await createTenantClient();
    const [from, to] = rangeFor({ page, pageSize });
    let query = supabase
      .from("ebay_listing_drafts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as EbayListingDraft[], count: count ?? 0, page, pageSize };
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: ListingsState,
  payload: { data: EbayListingDraft[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const listingsSlice = createSlice({
  name: "listings",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: EbayListingDraft[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addListingDraft(state, action: PayloadAction<EbayListingDraft>) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
    updateListingDraft(state, action: PayloadAction<EbayListingDraft>) {
      const idx = state.items.findIndex((d) => d.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removeListingDraft(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((d) => d.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchListingsPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchListingsPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchListingsPage.rejected, (state) => {
        state.isFetching = false;
      });
  },
});

export const { setFetching, hydratePage, addListingDraft, updateListingDraft, removeListingDraft } =
  listingsSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateListingDrafts` by name. */
export const hydrateListingDrafts = hydratePage;
