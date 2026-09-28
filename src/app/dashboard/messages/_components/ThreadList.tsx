import type { UIEvent } from "react";
import { avatarClassesFor, avatarInitial } from "../_lib/avatarColor";
import { threadDateLabel } from "../_lib/dayLabel";
import { messagePreview } from "../_lib/messageBody";
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
      <ul className="space-y-1 p-2">
        {threads.map((thread) => {
          const last = thread.messages[thread.messages.length - 1];
          const hasUnread = thread.unreadCount > 0;
          const selected = selectedKey === thread.key;
          return (
            <li key={thread.key}>
              <button
                type="button"
                onClick={() => onSelect(thread.key)}
                aria-current={selected ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-[var(--radius-card)] px-3 py-3 text-left transition-colors cursor-pointer ${
                  selected ? "bg-(--color-surface-subtle)" : "hover:bg-(--color-surface-subtle)"
                }`}
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClassesFor(thread.buyerUsername)}`}
                >
                  {avatarInitial(thread.buyerUsername)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate text-sm text-(--color-text-strong) ${hasUnread ? "font-bold" : "font-semibold"}`}
                    >
                      {thread.buyerUsername}
                    </span>
                    <span className="shrink-0 text-xs text-(--color-text-muted)">
                      {threadDateLabel(thread.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${hasUnread ? "text-(--color-text-strong)" : "text-(--color-text-muted)"}`}>
                      {last.direction === "outbound" ? "You: " : ""}
                      {messagePreview(last.body)}
                    </p>
                    {hasUnread && (
                      <span
                        aria-label={`${thread.unreadCount} awaiting reply`}
                        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-(--color-primary) px-1.5 text-[11px] font-semibold text-white tabular-nums"
                      >
                        {thread.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-(--color-text-faint)" title={thread.itemTitle ?? undefined}>
                    {thread.itemTitle ?? `Item ${thread.itemId}`}
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
