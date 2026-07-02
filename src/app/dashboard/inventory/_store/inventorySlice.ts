import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Product } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

// Lightweight shape used by product-link dropdowns in Sales/Purchases modals —
// does NOT go through pagination so every product is always available.
export interface ProductSelector {
  id: string;
  name: string;
  current_stock: number;
  sku?: string | null;
}

interface InventoryState {
  // ── Paginated table data (inventory page) ────────────────────────────────
  items: Product[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
  // ── Full selector list (dropdowns in Sales/Purchases modals) ─────────────
  selectorItems: ProductSelector[];
  selectorsLoaded: boolean;
}

const initialState: InventoryState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
  selectorItems: [],
  selectorsLoaded: false,
};

// ─── Thunks ───────────────────────────────────────────────────────────────────

export const fetchInventoryPage = createAsyncThunk(
  "inventory/fetchPage",
  async (params: { page: number; pageSize: number; search?: string }) => {
    const { page, pageSize, search } = params;

    const supabase = await createTenantClient();
    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .order("name", { ascending: true });

    if (search && search.trim()) {
      query = query.ilike("name", `%${search.trim()}%`);
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as Product[], count: count ?? 0, page, pageSize };
  }
);

/** Lightweight fetch — all products, id/name/current_stock/sku only, for dropdowns. */
export const fetchInventorySelectors = createAsyncThunk(
  "inventory/fetchSelectors",
  async () => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, name, current_stock, sku")
      .order("name", { ascending: true });

    if (error) throw error;

    return (data ?? []) as ProductSelector[];
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: InventoryState,
  payload: { data: Product[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const inventorySlice = createSlice({
  name: "inventory",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: Product[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    hydrateSelectors(state, action: PayloadAction<ProductSelector[]>) {
      state.selectorItems = action.payload;
      state.selectorsLoaded = true;
    },
    addProduct(state, action: PayloadAction<Product>) {
      state.items.unshift(action.payload);
      state.total += 1;
      // Keep selectorItems in sync with newly created products
      state.selectorItems.push({
        id: action.payload.id,
        name: action.payload.name,
        current_stock: action.payload.current_stock,
        sku: action.payload.sku,
      });
      state.selectorItems.sort((a, b) => a.name.localeCompare(b.name));
    },
    updateProduct(state, action: PayloadAction<Product>) {
      const idx = state.items.findIndex((p) => p.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
      // Keep selectorItems in sync
      const sIdx = state.selectorItems.findIndex((p) => p.id === action.payload.id);
      if (sIdx !== -1) {
        state.selectorItems[sIdx] = {
          id: action.payload.id,
          name: action.payload.name,
          current_stock: action.payload.current_stock,
          sku: action.payload.sku,
        };
      }
    },
    removeProduct(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((p) => p.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
      state.selectorItems = state.selectorItems.filter((p) => p.id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      // ── fetchInventoryPage ──────────────────────────────────────────────
      .addCase(fetchInventoryPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchInventoryPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchInventoryPage.rejected, (state) => {
        state.isFetching = false;
      })
      // ── fetchInventorySelectors ─────────────────────────────────────────
      .addCase(fetchInventorySelectors.fulfilled, (state, action) => {
        state.selectorItems = action.payload;
        state.selectorsLoaded = true;
      });
  },
});

export const {
  setFetching,
  hydratePage,
  hydrateSelectors,
  addProduct,
  updateProduct,
  removeProduct,
} = inventorySlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateProducts` by name. */
export const hydrateProducts = hydratePage;
