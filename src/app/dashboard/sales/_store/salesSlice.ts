import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Sale } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import { getPresetRange } from "@/lib/utils/filters";
import type { SalesFilters } from "@/lib/utils/filters";

interface SalesState {
  items: Sale[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
}

const initialState: SalesState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
};

// ─── Thunk ────────────────────────────────────────────────────────────────────

export const fetchSalesPage = createAsyncThunk(
  "sales/fetchPage",
  async (params: { page: number; pageSize: number; filters: SalesFilters }) => {
    const { page, pageSize, filters } = params;

    const supabase = await createTenantClient();
    let query = supabase
      .from("sales")
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

    if (filters.platform !== "all") {
      query = query.eq("platform", filters.platform);
    }
    if (filters.currency !== "all") {
      query = query.eq("currency", filters.currency);
    }
    if (filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as Sale[], count: count ?? 0, page, pageSize };
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: SalesState,
  payload: { data: Sale[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const salesSlice = createSlice({
  name: "sales",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: Sale[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addSale(state, action: PayloadAction<Sale>) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
    updateSale(state, action: PayloadAction<Sale>) {
      const idx = state.items.findIndex((s) => s.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removeSale(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((s) => s.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSalesPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchSalesPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchSalesPage.rejected, (state) => {
        state.isFetching = false;
      });
  },
});

export const { setFetching, hydratePage, addSale, updateSale, removeSale } =
  salesSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateSales` by name. */
export const hydrateSales = hydratePage;
