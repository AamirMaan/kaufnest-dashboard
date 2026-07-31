import type { EbayMessage } from "@/types";

export interface MessageThread {
  key: string;
  buyerUsername: string;
  itemId: string;
  messages: EbayMessage[]; // ascending by ebay_created_at
  lastMessageAt: string;
  unreadCount: number;
}

/** Groups a flat message list into per-(buyer, item) threads, most-recently-active first. */
export function groupThreads(messages: EbayMessage[]): MessageThread[] {
  const byKey = new Map<string, EbayMessage[]>();

  for (const message of messages) {
    const key = `${message.buyer_username}::${message.item_id}`;
    const list = byKey.get(key);
    if (list) list.push(message);
    else byKey.set(key, [message]);
  }

  const threads: MessageThread[] = [];
  for (const [key, msgs] of byKey) {
    const sorted = [...msgs].sort((a, b) => a.ebay_created_at.localeCompare(b.ebay_created_at));
    const last = sorted[sorted.length - 1];
    threads.push({
      key,
      buyerUsername: last.buyer_username,
      itemId: last.item_id,
      messages: sorted,
      lastMessageAt: last.ebay_created_at,
      unreadCount: sorted.filter((m) => m.direction === "inbound" && !m.is_read).length,
    });
  }

  return threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/** The most recent inbound message in a thread — replies thread off this one (its external_message_id becomes ParentMessageID). */
export function latestInboundMessage(thread: MessageThread): EbayMessage | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    if (thread.messages[i].direction === "inbound") return thread.messages[i];
  }
  return null;
}
