import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Expense, ExpensesSummaryRow } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import type { ExpenseFilters } from "@/lib/utils/filters";
import { expensesFilterParams } from "./expensesFilterParams";

interface ExpensesState {
  items: Expense[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
  summary: ExpensesSummaryRow[];
  summaryLoading: boolean;
  summaryError: boolean;
  /** Bumped by add/update/remove so the page refetches filtered totals after any mutation. */
  summaryVersion: number;
  /** requestId of the latest summary fetch — older responses are dropped (fast filter typing). */
  summaryRequestId: string | null;
}

const initialState: ExpensesState = {
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

export const fetchExpensesPage = createAsyncThunk(
  "expenses/fetchPage",
  async (params: { page: number; pageSize: number; filters: ExpenseFilters }) => {
    const { page, pageSize, filters } = params;

    const supabase = await createTenantClient();
    let query = supabase
      .from("expenses")
      .select("*", { count: "exact" })
      .order("date", { ascending: false });

    const p = expensesFilterParams(filters);
    if (p.p_from) query = query.gte("date", p.p_from);
    if (p.p_to) query = query.lte("date", p.p_to);
    if (p.p_category) query = query.eq("category", p.p_category);
    if (p.p_currency) query = query.eq("currency", p.p_currency);
    if (p.p_pattern) {
      query = query.or(
        `title.ilike."${p.p_pattern}",vendor.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}",invoice_number.ilike."${p.p_pattern}"`
      );
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as Expense[], count: count ?? 0, page, pageSize };
  }
);

/**
 * Filtered totals across ALL matching expenses (not just the loaded page) —
 * one row per currency from get_expenses_summary (049). Uses the same
 * `expensesFilterParams` as `fetchExpensesPage`, so tiles and table can't disagree.
 */
export const fetchExpensesSummary = createAsyncThunk(
  "expenses/fetchSummary",
  async (filters: ExpenseFilters) => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase.rpc("get_expenses_summary", expensesFilterParams(filters));
    // Never forward the raw Postgres error — the page shows a generic message.
    if (error) throw new Error("expenses_summary_failed");
    return (data ?? []) as ExpensesSummaryRow[];
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: ExpensesState,
  payload: { data: Expense[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const expensesSlice = createSlice({
  name: "expenses",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: Expense[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addExpense(state, action: PayloadAction<Expense>) {
      state.items.unshift(action.payload);
      state.total += 1;
      state.summaryVersion += 1;
    },
    updateExpense(state, action: PayloadAction<Expense>) {
      const idx = state.items.findIndex((e) => e.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
      state.summaryVersion += 1;
    },
    removeExpense(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((e) => e.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
      state.summaryVersion += 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchExpensesPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchExpensesPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchExpensesPage.rejected, (state) => {
        state.isFetching = false;
      })
      .addCase(fetchExpensesSummary.pending, (state, action) => {
        state.summaryRequestId = action.meta.requestId;
        state.summaryLoading = true;
      })
      .addCase(fetchExpensesSummary.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summary = action.payload;
        state.summaryLoading = false;
        state.summaryError = false;
      })
      .addCase(fetchExpensesSummary.rejected, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summaryLoading = false;
        state.summaryError = true;
      });
  },
});

export const { setFetching, hydratePage, addExpense, updateExpense, removeExpense } =
  expensesSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateExpenses` by name. */
export const hydrateExpenses = hydratePage;
