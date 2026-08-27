import {
  messagesSlice,
  hydrateMessages,
  addMessage,
  fetchMessagesPage,
  syncMessages,
  sendReply,
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
