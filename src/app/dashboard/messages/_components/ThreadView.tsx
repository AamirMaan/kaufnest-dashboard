import { formatDateTime } from "@/lib/utils/date";
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
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      {thread.messages.map((message) => (
        <div
          key={message.id}
          className={`max-w-[75%] rounded-(--radius-card) px-3 py-2 text-sm ${
            message.direction === "outbound"
              ? "self-end bg-(--color-primary) text-white"
              : "self-start bg-(--color-surface-hover) text-(--color-text-strong)"
          }`}
        >
          {message.subject && <p className="mb-1 text-xs font-semibold">{message.subject}</p>}
          <p className="whitespace-pre-wrap">{message.body}</p>
          <p className="mt-1 text-[10px] opacity-70">{formatDateTime(message.ebay_created_at)}</p>
        </div>
      ))}
    </div>
  );
}
