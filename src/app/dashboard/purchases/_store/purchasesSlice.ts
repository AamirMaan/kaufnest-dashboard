import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Purchase, PurchasesSummaryRow } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import type { PurchaseFilters } from "@/lib/utils/filters";
import { purchasesFilterParams } from "./purchasesFilterParams";

interface PurchasesState {
  items: Purchase[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
  summary: PurchasesSummaryRow[];
  summaryLoading: boolean;
  summaryError: boolean;
  /** Bumped by add/update/remove so the page refetches filtered totals after any mutation. */
  summaryVersion: number;
  /** requestId of the latest summary fetch — older responses are dropped (fast filter typing). */
  summaryRequestId: string | null;
}

const initialState: PurchasesState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
  summary: [],
  summaryLoading: false,
  summaryError: false,
  summaryVersion: 0,
  summaryRequestId: null,
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

    const p = purchasesFilterParams(filters);
    if (p.p_from) query = query.gte("date", p.p_from);
    if (p.p_to) query = query.lte("date", p.p_to);
    if (p.p_currency) query = query.eq("currency", p.p_currency);
    if (p.p_pattern) {
      query = query.or(
        `product_name.ilike."${p.p_pattern}",vendor.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}"`
      );
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as Purchase[], count: count ?? 0, page, pageSize };
  }
);

/**
 * Filtered totals across ALL matching purchases (not just the loaded page) —
 * one row per currency from get_purchases_summary (050). Uses the same
 * `purchasesFilterParams` as `fetchPurchasesPage`, so tiles and table can't disagree.
 */
export const fetchPurchasesSummary = createAsyncThunk(
  "purchases/fetchSummary",
  async (filters: PurchaseFilters) => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase.rpc("get_purchases_summary", purchasesFilterParams(filters));
    // Never forward the raw Postgres error — the page shows a generic message.
    if (error) throw new Error("purchases_summary_failed");
    return (data ?? []) as PurchasesSummaryRow[];
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
      state.summaryVersion += 1;
    },
    updatePurchase(state, action: PayloadAction<Purchase>) {
      const idx = state.items.findIndex((p) => p.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
      state.summaryVersion += 1;
    },
    removePurchase(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((p) => p.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
      state.summaryVersion += 1;
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
      })
      .addCase(fetchPurchasesSummary.pending, (state, action) => {
        state.summaryRequestId = action.meta.requestId;
        state.summaryLoading = true;
      })
      .addCase(fetchPurchasesSummary.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summary = action.payload;
        state.summaryLoading = false;
        state.summaryError = false;
      })
      .addCase(fetchPurchasesSummary.rejected, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summaryLoading = false;
        state.summaryError = true;
      });
  },
});

export const { setFetching, hydratePage, addPurchase, updatePurchase, removePurchase } =
  purchasesSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydratePurchases` by name. */
export const hydratePurchases = hydratePage;
