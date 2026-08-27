"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { hasPermission } from "@/lib/utils/permissions";
import { formatDateTime } from "@/lib/utils/date";
import { fetchMessagesPage, syncMessages, sendReply, searchMessages, clearSearch } from "./_store/messagesSlice";
import { groupThreads, latestInboundMessage } from "./_lib/groupThreads";
import { ThreadList } from "./_components/ThreadList";
import { ThreadView } from "./_components/ThreadView";
import { ReplyBox } from "./_components/ReplyBox";

// Debounce so every keystroke doesn't fire its own query — long enough to
// absorb normal typing speed, short enough that search still feels live.
const SEARCH_DEBOUNCE_MS = 300;

export default function MessagesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const permissionOverrides = useAppSelector((s) => s.currentUser.profile?.permission_overrides);
  const {
    items,
    page,
    pageSize,
    total,
    isFetching,
    isLoadingMore,
    isSyncing,
    searchQuery,
    searchResults,
  } = useAppSelector((s) => s.messages);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [searchInput, setSearchInput] = useState("");

  const canManage = role && hasPermission(role, "manage_messages", permissionOverrides);
  const isSearchActive = searchQuery.trim().length > 0;
  const threads = useMemo(
    () => groupThreads(isSearchActive ? searchResults : items),
    [isSearchActive, searchResults, items]
  );
  const selectedThread = threads.find((t) => t.key === selectedKey) ?? threads[0] ?? null;
  const replyTarget = selectedThread ? latestInboundMessage(selectedThread) : null;
  // Search results are a single bounded query (see messagesSlice), not paged
  // themselves — infinite scroll only applies to the normal thread list.
  const hasMoreThreads = !isSearchActive && items.length < total;

  // Debounced server-side search — client-side filtering would silently miss
  // any message not yet loaded into `items` by infinite scroll.
  useEffect(() => {
    const trimmed = searchInput.trim();
    const handle = setTimeout(() => {
      if (trimmed) {
        dispatch(searchMessages(trimmed));
      } else {
        dispatch(clearSearch());
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, dispatch]);

  function handleLoadMoreThreads() {
    if (isFetching || isLoadingMore || !hasMoreThreads) return;
    dispatch(fetchMessagesPage({ page: page + 1, pageSize }));
  }

  const runSync = useCallback(async () => {
    setSyncErrorMsg(null);
    try {
      const synced = await dispatch(syncMessages()).unwrap();
      await dispatch(fetchMessagesPage({ page: 1, pageSize }));
      setLastSyncedAt(new Date());
      if (synced > 0) success(`Synced ${synced} new message${synced === 1 ? "" : "s"}`);
    } catch (err) {
      setSyncErrorMsg(err instanceof Error ? err.message : "Sync failed");
    }
  }, [dispatch, pageSize, success]);

  // Fetches on every visit to this page — matches "open Messages, see what's
  // actually on eBay" rather than a manual button. Gated the same way the
  // removed button was: only users with manage_messages ever trigger a sync.
  // Deferred via a microtask (not called directly): runSync's first
  // statement is a synchronous setState, and calling that straight from an
  // effect body risks a cascading render (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!canManage) return;
    Promise.resolve().then(() => runSync());
  }, [canManage, runSync]);

  async function handleSend(text: string) {
    if (!replyTarget) return;
    setSending(true);
    try {
      await dispatch(sendReply({ messageId: replyTarget.id, text })).unwrap();
      success("Reply sent");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Reply failed");
    } finally {
      setSending(false);
    }
  }

  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader title="Messages" description="Reply to eBay buyer messages from your dashboard" />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            Upgrade to unlock Messages
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            eBay messaging is available on the Pro and Business plans.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block text-sm font-medium text-(--color-primary) hover:underline"
          >
            View plans &amp; billing →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Messages" description="Reply to eBay buyer messages from your dashboard" />

      {canManage && (
        <div className="mb-4 flex items-center gap-1.5 text-sm">
          {syncErrorMsg ? (
            <>
              <span className="text-(--color-danger)">Couldn&rsquo;t refresh messages.</span>
              <button
                type="button"
                onClick={runSync}
                className="font-medium text-(--color-primary) hover:underline"
              >
                Retry
              </button>
            </>
          ) : isSyncing ? (
            <span className="flex items-center gap-1.5 text-(--color-text-muted)">
              <RefreshCw size={14} className="animate-spin" />
              Checking eBay for new messages…
            </span>
          ) : (
            lastSyncedAt && (
              <span className="text-(--color-text-muted)">Updated {formatDateTime(lastSyncedAt.toISOString())}</span>
            )
          )}
        </div>
      )}
      {isFetching && <div className="mb-4 text-sm text-(--color-text-muted)">Loading…</div>}

      <div className="grid grid-cols-1 overflow-hidden rounded-(--radius-card) border border-(--color-border) md:grid-cols-[280px_1fr]">
        <div className="flex h-[600px] flex-col border-b border-(--color-border) md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 border-b border-(--color-border) px-3 py-2">
            <Search size={14} className="shrink-0 text-(--color-text-muted)" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search messages or sender…"
              aria-label="Search messages or sender"
              className="w-full bg-transparent text-sm text-(--color-text-strong) placeholder:text-(--color-text-muted) focus:outline-none"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
                className="shrink-0 text-(--color-text-muted) hover:text-(--color-text-strong)"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <ThreadList
              threads={threads}
              selectedKey={selectedThread?.key ?? null}
              onSelect={setSelectedKey}
              onLoadMore={handleLoadMoreThreads}
              hasMore={hasMoreThreads}
              isLoadingMore={isLoadingMore}
              emptyMessage={isSearchActive ? "No conversations match your search." : undefined}
            />
          </div>
        </div>
        <div className="flex h-[600px] flex-col">
          <div className="flex-1 overflow-hidden">
            <ThreadView thread={selectedThread} />
          </div>
          {selectedThread && canManage && (
            <ReplyBox
              disabled={!replyTarget}
              disabledReason={!replyTarget ? "No buyer message to reply to in this thread." : undefined}
              sending={sending}
              onSend={handleSend}
            />
          )}
        </div>
      </div>
    </div>
  );
}
