import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Sale, SalesSummaryRow } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import type { SalesFilters } from "@/lib/utils/filters";
import { salesFilterParams } from "./salesFilterParams";

interface SalesState {
  items: Sale[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
  summary: SalesSummaryRow[];
  summaryLoading: boolean;
  summaryError: boolean;
  /** Bumped by add/update/remove so the page refetches filtered totals after any mutation. */
  summaryVersion: number;
  /** requestId of the latest summary fetch — older responses are dropped (fast filter typing). */
  summaryRequestId: string | null;
}

const initialState: SalesState = {
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

export const fetchSalesPage = createAsyncThunk(
  "sales/fetchPage",
  async (params: { page: number; pageSize: number; filters: SalesFilters }) => {
    const { page, pageSize, filters } = params;

    const supabase = await createTenantClient();
    let query = supabase
      .from("sales")
      .select("*", { count: "exact" })
      .order("date", { ascending: false });

    const p = salesFilterParams(filters);
    if (p.p_from) query = query.gte("date", p.p_from);
    if (p.p_to) query = query.lte("date", p.p_to);
    if (p.p_platform) query = query.eq("platform", p.p_platform);
    if (p.p_currency) query = query.eq("currency", p.p_currency);
    if (p.p_status) query = query.eq("status", p.p_status);
    if (p.p_pattern) {
      query = query.or(
        `product_name.ilike."${p.p_pattern}",external_order_id.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}"`
      );
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as Sale[], count: count ?? 0, page, pageSize };
  }
);

/**
 * Filtered totals across ALL matching sales (not just the loaded page) —
 * one row per currency from get_sales_summary (050). Uses the same
 * `salesFilterParams` as `fetchSalesPage`, so tiles and table can't disagree.
 */
export const fetchSalesSummary = createAsyncThunk(
  "sales/fetchSummary",
  async (filters: SalesFilters) => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase.rpc("get_sales_summary", salesFilterParams(filters));
    // Never forward the raw Postgres error — the page shows a generic message.
    if (error) throw new Error("sales_summary_failed");
    return (data ?? []) as SalesSummaryRow[];
  }
);

/**
 * Re-fetch a single sale by id. Returns `null` when the row is gone or the
 * read fails.
 *
 * Used to reconcile Redux after a **server-side** write the client didn't make
 * itself — specifically the eBay sync-status route, which stamps
 * `ebay_fulfillment_id`/`ebay_sync_error`/`ebay_synced_at` on the row after
 * the client's own `sales.update(...)` has already returned. Both
 * `EditSaleModal` (save-time sync) and `[id]/page.tsx` (Retry) call this and
 * dispatch `updateSale(fresh)`; without it the order detail page — which
 * renders from Redux when a store version exists — never shows (or clears)
 * the Retry row until a full page reload.
 */
export async function fetchSaleById(saleId: string): Promise<Sale | null> {
  const supabase = await createTenantClient();
  const { data } = await supabase
    .from("sales")
    .select("*")
    .eq("id", saleId)
    .single<Sale>();
  return data ?? null;
}

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
      state.summaryVersion += 1;
    },
    updateSale(state, action: PayloadAction<Sale>) {
      const idx = state.items.findIndex((s) => s.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
      state.summaryVersion += 1;
    },
    removeSale(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((s) => s.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
      state.summaryVersion += 1;
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
      })
      .addCase(fetchSalesSummary.pending, (state, action) => {
        state.summaryRequestId = action.meta.requestId;
        state.summaryLoading = true;
      })
      .addCase(fetchSalesSummary.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summary = action.payload;
        state.summaryLoading = false;
        state.summaryError = false;
      })
      .addCase(fetchSalesSummary.rejected, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summaryLoading = false;
        state.summaryError = true;
      });
  },
});

export const { setFetching, hydratePage, addSale, updateSale, removeSale } =
  salesSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateSales` by name. */
export const hydrateSales = hydratePage;
