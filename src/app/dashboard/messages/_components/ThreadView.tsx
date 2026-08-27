import { formatDateTime } from "@/lib/utils/date";
import { avatarClassesFor, avatarInitial } from "../_lib/avatarColor";
import type { MessageThread } from "../_lib/groupThreads";

interface Props {
  thread: MessageThread | null;
}

export function ThreadView({ thread }: Props) {
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-(--color-text-muted)">
        Select a conversation
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-(--color-border) px-4 py-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClassesFor(thread.buyerUsername)}`}
        >
          {avatarInitial(thread.buyerUsername)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-(--color-text-strong)">{thread.buyerUsername}</p>
          <p className="truncate text-xs text-(--color-text-muted)">Item {thread.itemId}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {thread.messages.map((message) => {
          const needsReply = message.direction === "inbound" && !message.is_read;
          return (
            <div
              key={message.id}
              className={`max-w-[75%] rounded-(--radius-card) px-3 py-2 text-sm ${
                message.direction === "outbound"
                  ? "self-end bg-(--color-primary) text-white"
                  : needsReply
                    ? "self-start border-l-4 border-(--color-warning) bg-(--color-warning-bg) text-(--color-text-strong)"
                    : "self-start bg-(--color-surface-hover) text-(--color-text-strong)"
              }`}
            >
              {message.subject && <p className="mb-1 text-xs font-semibold">{message.subject}</p>}
              <p className="whitespace-pre-wrap">{message.body}</p>
              <p className="mt-1 text-[10px] opacity-70">{formatDateTime(message.ebay_created_at)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
