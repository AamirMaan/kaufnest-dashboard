import {
  messagesSlice,
  hydrateMessages,
  addMessage,
  fetchMessagesPage,
  syncMessages,
  sendReply,
  searchMessages,
  clearSearch,
} from "./messagesSlice";
import type { EbayMessage } from "@/types";

const makeMessage = (overrides: Partial<EbayMessage> = {}): EbayMessage => ({
  id: "msg-1",
  external_message_id: "ext-1",
  item_id: "item-1",
  buyer_username: "buyer1",
  direction: "inbound",
  subject: "Question about item",
  body: "Is this still available?",
  question_type: "General",
  is_read: false,
  ebay_created_at: "2026-07-20T10:00:00.000Z",
  item_title: null,
  item_price: null,
  item_currency: null,
  item_url: null,
  created_at: "2026-07-20T10:00:00.000Z",
  updated_at: "2026-07-20T10:00:00.000Z",
  ...overrides,
});

describe("messagesSlice", () => {
  const { reducer } = messagesSlice;

  it("starts empty with loaded=false and pagination defaults", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
    expect(state.isSyncing).toBe(false);
  });

  it("hydrates messages via hydrateMessages (hydratePage alias)", () => {
    const state = reducer(
      undefined,
      hydrateMessages({ data: [makeMessage()], count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.total).toBe(1);
  });

  it("prepends a new message via addMessage and increments total", () => {
    const base = reducer(
      undefined,
      hydrateMessages({ data: [makeMessage()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(base, addMessage(makeMessage({ id: "msg-new" })));
    expect(state.items[0].id).toBe("msg-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("sets isFetching=true on fetchMessagesPage.pending", () => {
    const state = reducer(undefined, fetchMessagesPage.pending("req-id", { page: 1, pageSize: 50 }));
    expect(state.isFetching).toBe(true);
  });

  it("applies page data on fetchMessagesPage.fulfilled", () => {
    const payload = { data: [makeMessage({ id: "msg-3" })], count: 4, page: 2, pageSize: 50 };
    const state = reducer(
      undefined,
      fetchMessagesPage.fulfilled(payload, "req-id", { page: 2, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(4);
    expect(state.page).toBe(2);
    expect(state.isFetching).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it("clears isFetching on fetchMessagesPage.rejected", () => {
    const pending = reducer(undefined, fetchMessagesPage.pending("req-id", { page: 1, pageSize: 50 }));
    const state = reducer(
      pending,
      fetchMessagesPage.rejected(new Error("fail"), "req-id", { page: 1, pageSize: 50 })
    );
    expect(state.isFetching).toBe(false);
  });

  it("tracks page>1 loading as isLoadingMore, not isFetching (infinite scroll)", () => {
    const pending = reducer(undefined, fetchMessagesPage.pending("req-id", { page: 2, pageSize: 50 }));
    expect(pending.isLoadingMore).toBe(true);
    expect(pending.isFetching).toBe(false);

    const rejected = reducer(
      pending,
      fetchMessagesPage.rejected(new Error("fail"), "req-id", { page: 2, pageSize: 50 })
    );
    expect(rejected.isLoadingMore).toBe(false);
  });

  it("appends page data when page > 1, replaces when page === 1 (infinite scroll)", () => {
    const page1 = reducer(
      undefined,
      fetchMessagesPage.fulfilled(
        { data: [makeMessage({ id: "msg-1" })], count: 3, page: 1, pageSize: 50 },
        "req-id",
        { page: 1, pageSize: 50 }
      )
    );
    expect(page1.items.map((m) => m.id)).toEqual(["msg-1"]);

    const page2 = reducer(
      page1,
      fetchMessagesPage.fulfilled(
        { data: [makeMessage({ id: "msg-2" })], count: 3, page: 2, pageSize: 50 },
        "req-id",
        { page: 2, pageSize: 50 }
      )
    );
    expect(page2.items.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    expect(page2.isLoadingMore).toBe(false);

    // A page-1 refetch (e.g. after sync) discards accumulated scroll pages.
    const refreshed = reducer(
      page2,
      fetchMessagesPage.fulfilled(
        { data: [makeMessage({ id: "msg-fresh" })], count: 1, page: 1, pageSize: 50 },
        "req-id",
        { page: 1, pageSize: 50 }
      )
    );
    expect(refreshed.items.map((m) => m.id)).toEqual(["msg-fresh"]);
  });

  it("sets isSearching across the searchMessages lifecycle and stores query + results", () => {
    const pending = reducer(undefined, searchMessages.pending("req-id", "buyer1"));
    expect(pending.isSearching).toBe(true);

    const fulfilled = reducer(
      pending,
      searchMessages.fulfilled(
        { query: "buyer1", data: [makeMessage({ id: "msg-found" })] },
        "req-id",
        "buyer1"
      )
    );
    expect(fulfilled.isSearching).toBe(false);
    expect(fulfilled.searchQuery).toBe("buyer1");
    expect(fulfilled.searchResults.map((m) => m.id)).toEqual(["msg-found"]);

    const rejectedFrom = reducer(
      pending,
      searchMessages.rejected(new Error("fail"), "req-id", "buyer1")
    );
    expect(rejectedFrom.isSearching).toBe(false);
  });

  it("clearSearch resets query and results", () => {
    const searched = reducer(
      undefined,
      searchMessages.fulfilled({ query: "buyer1", data: [makeMessage()] }, "req-id", "buyer1")
    );
    const cleared = reducer(searched, clearSearch());
    expect(cleared.searchQuery).toBe("");
    expect(cleared.searchResults).toEqual([]);
  });

  it("sets isSyncing across the syncMessages lifecycle", () => {
    const pending = reducer(undefined, syncMessages.pending("req-id", undefined));
    expect(pending.isSyncing).toBe(true);

    const fulfilled = reducer(pending, syncMessages.fulfilled(3, "req-id", undefined));
    expect(fulfilled.isSyncing).toBe(false);

    const rejectedFrom = reducer(pending, syncMessages.rejected(new Error("fail"), "req-id", undefined));
    expect(rejectedFrom.isSyncing).toBe(false);
  });

  it("prepends the sent reply on sendReply.fulfilled", () => {
    const base = reducer(
      undefined,
      hydrateMessages({ data: [makeMessage()], count: 1, page: 1, pageSize: 50 })
    );
    const reply = makeMessage({ id: "msg-reply", direction: "outbound", external_message_id: null });
    const state = reducer(
      base,
      sendReply.fulfilled(reply, "req-id", { messageId: "msg-1", text: "Yes, still available!" })
    );
    expect(state.items[0].id).toBe("msg-reply");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });
});
