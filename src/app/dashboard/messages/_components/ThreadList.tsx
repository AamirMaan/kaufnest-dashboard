import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import { avatarClassesFor, avatarInitial } from "../_lib/avatarColor";
import type { MessageThread } from "../_lib/groupThreads";

interface Props {
  threads: MessageThread[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function ThreadList({ threads, selectedKey, onSelect }: Props) {
  if (threads.length === 0) {
    return (
      <div className="p-4 text-sm text-(--color-text-muted)">
        No messages yet. Click &ldquo;Sync messages&rdquo; to pull in the latest from eBay.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-(--color-border)">
      {threads.map((thread) => {
        const last = thread.messages[thread.messages.length - 1];
        const hasUnread = thread.unreadCount > 0;
        return (
          <li key={thread.key}>
            <button
              type="button"
              onClick={() => onSelect(thread.key)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-(--color-surface-subtle) ${
                selectedKey === thread.key ? "bg-(--color-surface-subtle)" : ""
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClassesFor(thread.buyerUsername)}`}
              >
                {avatarInitial(thread.buyerUsername)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`truncate text-sm text-(--color-text-strong) ${hasUnread ? "font-bold" : "font-medium"}`}
                  >
                    {thread.buyerUsername}
                  </span>
                  {hasUnread && <Badge label={String(thread.unreadCount)} variant="warning" />}
                </div>
                <p className="mt-1 truncate text-xs text-(--color-text-muted)">Item {thread.itemId}</p>
                <p className="mt-1 truncate text-xs text-(--color-text-muted)">{last.body}</p>
                <p className="mt-1 text-xs text-(--color-text-muted)">
                  {formatDateTime(thread.lastMessageAt)}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
