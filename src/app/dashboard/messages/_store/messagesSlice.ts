import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { EbayMessage } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

interface MessagesState {
  items: EbayMessage[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
  isSyncing: boolean;
}

const initialState: MessagesState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
  isSyncing: false,
};

// ─── Thunks ───────────────────────────────────────────────────────────────────

export const fetchMessagesPage = createAsyncThunk(
  "messages/fetchPage",
  async (params: { page: number; pageSize: number }) => {
    const { page, pageSize } = params;

    const supabase = await createTenantClient();
    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await supabase
      .from("ebay_messages")
      .select("*", { count: "exact" })
      .order("ebay_created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as EbayMessage[], count: count ?? 0, page, pageSize };
  }
);

/** Calls the eBay sync route. Returns the count synced — caller re-fetches page 1 on success. */
export const syncMessages = createAsyncThunk("messages/sync", async () => {
  const res = await fetch("/api/messages/ebay/sync", { method: "POST" });
  const body = (await res.json()) as { synced?: number; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Sync failed");
  return body.synced ?? 0;
});

export const sendReply = createAsyncThunk(
  "messages/sendReply",
  async (params: { messageId: string; text: string }) => {
    const res = await fetch(`/api/messages/${params.messageId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: params.text }),
    });
    const body = (await res.json()) as EbayMessage & { error?: string };
    if (!res.ok) throw new Error((body as { error?: string }).error ?? "Reply failed");
    return body;
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: MessagesState,
  payload: { data: EbayMessage[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const messagesSlice = createSlice({
  name: "messages",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: EbayMessage[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addMessage(state, action: PayloadAction<EbayMessage>) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMessagesPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchMessagesPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchMessagesPage.rejected, (state) => {
        state.isFetching = false;
      })
      .addCase(syncMessages.pending, (state) => {
        state.isSyncing = true;
      })
      .addCase(syncMessages.fulfilled, (state) => {
        state.isSyncing = false;
      })
      .addCase(syncMessages.rejected, (state) => {
        state.isSyncing = false;
      })
      .addCase(sendReply.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.total += 1;
      });
  },
});

export const { setFetching, hydratePage, addMessage } = messagesSlice.actions;

/** Alias kept consistent with the listings/StoreProvider hydration naming convention. */
export const hydrateMessages = hydratePage;
