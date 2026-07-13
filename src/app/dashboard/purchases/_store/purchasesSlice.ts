import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Purchase } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import { getPresetRange, sanitizeIlikeSearchTerm } from "@/lib/utils/filters";
import type { PurchaseFilters } from "@/lib/utils/filters";

interface PurchasesState {
  items: Purchase[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
}

const initialState: PurchasesState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
};

// ─── Thunk ────────────────────────────────────────────────────────────────────

export const fetchPurchasesPage = createAsyncThunk(
  "purchases/fetchPage",
  async (params: { page: number; pageSize: number; filters: PurchaseFilters }) => {
    const { page, pageSize, filters } = params;

    const supabase = await createTenantClient();
    let query = supabase
      .from("purchases")
      .select("*", { count: "exact" })
      .order("date", { ascending: false });

    // Date filters — resolve preset or custom range
    const range =
      filters.preset === "custom"
        ? { from: filters.dateFrom || "0000-00-00", to: filters.dateTo || "9999-99-99" }
        : getPresetRange(filters.preset);
    if (range && filters.preset !== "all") {
      query = query.gte("date", range.from).lte("date", range.to);
    }

    if (filters.vendor.trim() !== "") {
      query = query.ilike("vendor", `%${filters.vendor.trim()}%`);
    }
    if (filters.currency !== "all") {
      query = query.eq("currency", filters.currency);
    }

    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike.%${term}%,vendor.ilike.%${term}%,description.ilike.%${term}%`
      );
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as Purchase[], count: count ?? 0, page, pageSize };
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: PurchasesState,
  payload: { data: Purchase[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const purchasesSlice = createSlice({
  name: "purchases",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: Purchase[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addPurchase(state, action: PayloadAction<Purchase>) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
    updatePurchase(state, action: PayloadAction<Purchase>) {
      const idx = state.items.findIndex((p) => p.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removePurchase(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((p) => p.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPurchasesPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchPurchasesPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchPurchasesPage.rejected, (state) => {
        state.isFetching = false;
      });
  },
});

export const { setFetching, hydratePage, addPurchase, updatePurchase, removePurchase } =
  purchasesSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydratePurchases` by name. */
export const hydratePurchases = hydratePage;
