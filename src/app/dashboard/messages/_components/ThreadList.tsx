import type { UIEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import { avatarClassesFor, avatarInitial } from "../_lib/avatarColor";
import type { MessageThread } from "../_lib/groupThreads";

// How close to the bottom (px) before the next page loads. Large enough that
// the fetch completes before the user actually hits the end of the list.
const LOAD_MORE_THRESHOLD_PX = 150;

interface Props {
  threads: MessageThread[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  emptyMessage?: string;
}

export function ThreadList({
  threads,
  selectedKey,
  onSelect,
  onLoadMore,
  hasMore,
  isLoadingMore,
  emptyMessage,
}: Props) {
  function handleScroll(e: UIEvent<HTMLDivElement>) {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD_PX) {
      onLoadMore();
    }
  }

  if (threads.length === 0) {
    return (
      <div className="p-4 text-sm text-(--color-text-muted)">
        {emptyMessage ?? "No messages yet. Click “Sync messages” to pull in the latest from eBay."}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" onScroll={handleScroll}>
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
      {isLoadingMore && (
        <div className="p-3 text-center text-xs text-(--color-text-muted)">Loading more…</div>
      )}
    </div>
  );
}
