import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createTenantClient } from "@/lib/supabase/client";
import { DEFAULT_PAGE_SIZE, rangeFor } from "@/lib/utils/pagedQuery";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import type { StockTransfer } from "@/types";

/** A transfer as the history table shows it — product name embedded via the product_id FK. */
export interface StockTransferRow extends StockTransfer {
  product_name: string | null;
}

interface TransfersState {
  items: StockTransferRow[];
  page: number;
  pageSize: number;
  total: number;
  loaded: boolean;
  isFetching: boolean;
  error: string | null;
}

const initialState: TransfersState = {
  items: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  loaded: false,
  isFetching: false,
  error: null,
};

type TransferWithProduct = StockTransfer & { products: { name: string } | null };

/** Newest first. Transfers grow with the business, so always paged. */
export const fetchTransfersPage = createAsyncThunk(
  "stockTransfers/fetchPage",
  async ({ page, pageSize }: { page: number; pageSize: number }) => {
    const supabase = await createTenantClient();
    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await supabase
      .from("stock_transfers")
      .select("*, products(name)", { count: "exact" })
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(inventoryErrorMessage(error, "Could not load transfers."));
    const rows = ((data ?? []) as TransferWithProduct[]).map(({ products, ...t }) => ({
      ...t,
      product_name: products?.name ?? null,
    }));
    return { data: rows, count: count ?? 0, page, pageSize };
  },
);

export const transfersSlice = createSlice({
  name: "stockTransfers",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransfersPage.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(fetchTransfersPage.fulfilled, (state, action) => {
        state.items = action.payload.data;
        state.total = action.payload.count;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchTransfersPage.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message ?? "Could not load transfers.";
      });
  },
});
