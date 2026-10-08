import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createTenantClient } from "@/lib/supabase/client";
import { DEFAULT_PAGE_SIZE, rangeFor } from "@/lib/utils/pagedQuery";
import type { PlatformPayout } from "@/types";
import { payoutFilterParams, type PayoutFilters } from "../_lib/payoutFilters";

export const PAYOUTS_LOAD_ERROR = "Could not load payouts.";

interface PayoutsState {
  items: PlatformPayout[];
  page: number;
  pageSize: number;
  total: number;
  loaded: boolean;
  isFetching: boolean;
  error: string | null;
}

const initialState: PayoutsState = {
  items: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  loaded: false,
  isFetching: false,
  error: null,
};

/** Newest first. Payouts grow with the business, so always paged. */
export const fetchPayoutsPage = createAsyncThunk(
  "payouts/fetchPage",
  async ({ page, pageSize, filters }: { page: number; pageSize: number; filters: PayoutFilters }) => {
    const supabase = await createTenantClient();
    const p = payoutFilterParams(filters);
    let query = supabase
      .from("platform_payouts")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (p.from) query = query.gte("date", p.from);
    if (p.to) query = query.lte("date", p.to);
    if (p.platform) query = query.eq("platform", p.platform);
    if (p.currency) query = query.eq("currency", p.currency);
    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);
    // Never forward the raw Postgres error — the page shows PAYOUTS_LOAD_ERROR.
    if (error) throw new Error(PAYOUTS_LOAD_ERROR);
    return { data: (data ?? []) as PlatformPayout[], count: count ?? 0, page, pageSize };
  },
);

export const payoutsSlice = createSlice({
  name: "payouts",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPayoutsPage.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(fetchPayoutsPage.fulfilled, (state, action) => {
        state.items = action.payload.data;
        state.total = action.payload.count;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchPayoutsPage.rejected, (state) => {
        state.isFetching = false;
        state.error = PAYOUTS_LOAD_ERROR;
      });
  },
});
