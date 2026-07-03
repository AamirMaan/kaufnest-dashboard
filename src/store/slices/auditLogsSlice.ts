import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { AuditLog } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import { getPresetRange } from "@/lib/utils/filters";
import type { AuditLogFilters } from "@/lib/utils/filters";

interface AuditLogsState {
  items: AuditLog[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
}

const initialState: AuditLogsState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
};

// ─── Thunk ────────────────────────────────────────────────────────────────────

export const fetchAuditLogsPage = createAsyncThunk(
  "auditLogs/fetchPage",
  async (params: { page: number; pageSize: number; filters: AuditLogFilters }) => {
    const { page, pageSize, filters } = params;

    const supabase = await createTenantClient();
    let query = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    // Date filters — resolve preset or custom range (filters against created_at)
    const range =
      filters.preset === "custom"
        ? { from: filters.dateFrom || "0000-00-00", to: filters.dateTo || "9999-99-99" }
        : getPresetRange(filters.preset);
    if (range && filters.preset !== "all") {
      query = query.gte("created_at", range.from).lte("created_at", range.to + "T23:59:59.999Z");
    }

    if (filters.action !== "all") {
      query = query.eq("action", filters.action);
    }
    if (filters.user_id !== "all") {
      query = query.eq("user_id", filters.user_id);
    }

    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as AuditLog[], count: count ?? 0, page, pageSize };
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: AuditLogsState,
  payload: { data: AuditLog[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const auditLogsSlice = createSlice({
  name: "auditLogs",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: AuditLog[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addAuditLog(state, action: PayloadAction<AuditLog>) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAuditLogsPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchAuditLogsPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchAuditLogsPage.rejected, (state) => {
        state.isFetching = false;
      });
  },
});

export const { setFetching, hydratePage, addAuditLog } = auditLogsSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateAuditLogs` by name. */
export const hydrateAuditLogs = hydratePage;
