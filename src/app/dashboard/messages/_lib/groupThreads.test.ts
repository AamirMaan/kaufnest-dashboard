import { groupThreads, latestInboundMessage } from "./groupThreads";
import type { EbayMessage } from "@/types";

const makeMessage = (overrides: Partial<EbayMessage> = {}): EbayMessage => ({
  id: "msg-1",
  external_message_id: "ext-1",
  item_id: "item-1",
  buyer_username: "buyer1",
  direction: "inbound",
  subject: null,
  body: "Hello",
  question_type: null,
  is_read: false,
  ebay_created_at: "2026-07-20T10:00:00.000Z",
  created_at: "2026-07-20T10:00:00.000Z",
  updated_at: "2026-07-20T10:00:00.000Z",
  ...overrides,
});

describe("groupThreads", () => {
  it("groups messages by buyer_username + item_id", () => {
    const threads = groupThreads([
      makeMessage({ id: "a", buyer_username: "alice", item_id: "1" }),
      makeMessage({ id: "b", buyer_username: "bob", item_id: "1" }),
      makeMessage({ id: "c", buyer_username: "alice", item_id: "1" }),
    ]);

    expect(threads).toHaveLength(2);
    const aliceThread = threads.find((t) => t.buyerUsername === "alice");
    expect(aliceThread?.messages).toHaveLength(2);
  });

  it("treats the same buyer on different items as separate threads", () => {
    const threads = groupThreads([
      makeMessage({ id: "a", buyer_username: "alice", item_id: "1" }),
      makeMessage({ id: "b", buyer_username: "alice", item_id: "2" }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it("sorts a thread's messages ascending by ebay_created_at", () => {
    const threads = groupThreads([
      makeMessage({ id: "later", ebay_created_at: "2026-07-20T12:00:00.000Z" }),
      makeMessage({ id: "earlier", ebay_created_at: "2026-07-20T09:00:00.000Z" }),
    ]);
    expect(threads[0].messages.map((m) => m.id)).toEqual(["earlier", "later"]);
  });

  it("sorts threads by most-recently-active first", () => {
    const threads = groupThreads([
      makeMessage({ id: "a", buyer_username: "alice", item_id: "1", ebay_created_at: "2026-07-18T00:00:00.000Z" }),
      makeMessage({ id: "b", buyer_username: "bob", item_id: "2", ebay_created_at: "2026-07-20T00:00:00.000Z" }),
    ]);
    expect(threads[0].buyerUsername).toBe("bob");
    expect(threads[1].buyerUsername).toBe("alice");
  });

  it("counts only unread inbound messages toward unreadCount", () => {
    const threads = groupThreads([
      makeMessage({ id: "a", direction: "inbound", is_read: false }),
      makeMessage({ id: "b", direction: "inbound", is_read: true }),
      makeMessage({ id: "c", direction: "outbound", is_read: false }),
    ]);
    expect(threads[0].unreadCount).toBe(1);
  });
});

describe("latestInboundMessage", () => {
  it("returns the most recent inbound message in a thread", () => {
    const threads = groupThreads([
      makeMessage({ id: "in1", direction: "inbound", ebay_created_at: "2026-07-20T09:00:00.000Z" }),
      makeMessage({ id: "out1", direction: "outbound", ebay_created_at: "2026-07-20T10:00:00.000Z" }),
      makeMessage({ id: "in2", direction: "inbound", ebay_created_at: "2026-07-20T11:00:00.000Z" }),
    ]);
    expect(latestInboundMessage(threads[0])?.id).toBe("in2");
  });

  it("returns null when the thread has no inbound messages", () => {
    const threads = groupThreads([makeMessage({ id: "out1", direction: "outbound" })]);
    expect(latestInboundMessage(threads[0])).toBeNull();
  });
});
