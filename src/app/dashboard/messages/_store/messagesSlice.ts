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
  isLoadingMore: boolean;
  isSyncing: boolean;
  searchQuery: string;
  searchResults: EbayMessage[];
  isSearching: boolean;
}

const initialState: MessagesState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
  isLoadingMore: false,
  isSyncing: false,
  searchQuery: "",
  searchResults: [],
  isSearching: false,
};

// Server-side search cap — a chat search box doesn't need its own pagination
// on top of infinite scroll; 200 matches is far more than a human scans
// through in one search, and keeps the query cheap.
const SEARCH_RESULT_LIMIT = 200;

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

/**
 * Server-side search over buyer name + message body — client-side filtering
 * would silently miss anything not yet loaded into `items` by infinite
 * scroll (see AGENTS.md's pagination architecture rule: filters are pushed
 * into the query, not applied client-side). ilike wildcard characters in the
 * search text are escaped so a literal "%" or "_" doesn't act as a pattern.
 */
export const searchMessages = createAsyncThunk("messages/search", async (query: string) => {
  const trimmed = query.trim();
  const supabase = await createTenantClient();
  const escaped = trimmed.replace(/[%_]/g, (c) => `\\${c}`);
  const { data, error } = await supabase
    .from("ebay_messages")
    .select("*")
    .or(`body.ilike.%${escaped}%,buyer_username.ilike.%${escaped}%`)
    .order("ebay_created_at", { ascending: false })
    .limit(SEARCH_RESULT_LIMIT);

  if (error) throw error;
  return { query: trimmed, data: (data ?? []) as EbayMessage[] };
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
    clearSearch(state) {
      state.searchQuery = "";
      state.searchResults = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMessagesPage.pending, (state, action) => {
        // page 1 is a full reload (initial visit, or refetch after sync);
        // page > 1 is infinite scroll loading more — tracked separately so
        // the two never show the same loading indicator.
        if (action.meta.arg.page > 1) {
          state.isLoadingMore = true;
        } else {
          state.isFetching = true;
        }
      })
      .addCase(fetchMessagesPage.fulfilled, (state, action) => {
        const { data, count, page, pageSize } = action.payload;
        state.items = page === 1 ? data : [...state.items, ...data];
        state.page = page;
        state.pageSize = pageSize;
        state.total = count;
        state.isFetching = false;
        state.isLoadingMore = false;
        state.loaded = true;
      })
      .addCase(fetchMessagesPage.rejected, (state) => {
        state.isFetching = false;
        state.isLoadingMore = false;
      })
      .addCase(searchMessages.pending, (state) => {
        state.isSearching = true;
      })
      .addCase(searchMessages.fulfilled, (state, action) => {
        state.isSearching = false;
        state.searchQuery = action.payload.query;
        state.searchResults = action.payload.data;
      })
      .addCase(searchMessages.rejected, (state) => {
        state.isSearching = false;
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

export const { setFetching, hydratePage, addMessage, clearSearch } = messagesSlice.actions;

/** Alias kept consistent with the listings/StoreProvider hydration naming convention. */
export const hydrateMessages = hydratePage;
