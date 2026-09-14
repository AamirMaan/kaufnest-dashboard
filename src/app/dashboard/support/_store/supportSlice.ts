import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { BugReport } from "@/types";

interface SupportState {
  items: BugReport[];
  loaded: boolean;
  isFetching: boolean;
  isSubmitting: boolean;
  selectedId: string | null;
  error: string | null;
}

const initialState: SupportState = {
  items: [],
  loaded: false,
  isFetching: false,
  isSubmitting: false,
  selectedId: null,
  error: null,
};

/**
 * Reads through the API route, not Supabase directly: bug reports live in the
 * control plane, which the browser cannot reach by design.
 */
export const fetchReports = createAsyncThunk("support/fetch", async () => {
  const res = await fetch("/api/support/reports");
  const body = (await res.json()) as { reports?: BugReport[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Could not load your reports.");
  return body.reports ?? [];
});

/** Posts multipart form data — the browser never holds Trello credentials. */
export const submitReport = createAsyncThunk("support/submit", async (form: FormData) => {
  const res = await fetch("/api/support/report", { method: "POST", body: form });
  const body = (await res.json()) as { report?: BugReport; warning?: string; error?: string };
  if (!res.ok || !body.report) throw new Error(body.error ?? "Could not send your report.");
  return { report: body.report, warning: body.warning };
});

export const supportSlice = createSlice({
  name: "support",
  initialState,
  reducers: {
    selectReport(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReports.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(fetchReports.fulfilled, (state, action: PayloadAction<BugReport[]>) => {
        state.items = action.payload;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchReports.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message ?? "Could not load your reports.";
      })
      .addCase(submitReport.pending, (state) => {
        state.isSubmitting = true;
      })
      .addCase(submitReport.fulfilled, (state, action) => {
        state.items.unshift(action.payload.report);
        state.isSubmitting = false;
      })
      .addCase(submitReport.rejected, (state) => {
        state.isSubmitting = false;
      });
  },
});

export const { selectReport } = supportSlice.actions;
