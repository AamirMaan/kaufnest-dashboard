"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { hasPermission } from "@/lib/utils/permissions";
import { fetchMessagesPage, syncMessages, sendReply } from "./_store/messagesSlice";
import { groupThreads, latestInboundMessage } from "./_lib/groupThreads";
import { ThreadList } from "./_components/ThreadList";
import { ThreadView } from "./_components/ThreadView";
import { ReplyBox } from "./_components/ReplyBox";

export default function MessagesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const permissionOverrides = useAppSelector((s) => s.currentUser.profile?.permission_overrides);
  const { items, page, pageSize, total, isFetching, isSyncing } = useAppSelector((s) => s.messages);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const canManage = role && hasPermission(role, "manage_messages", permissionOverrides);
  const threads = useMemo(() => groupThreads(items), [items]);
  const selectedThread = threads.find((t) => t.key === selectedKey) ?? threads[0] ?? null;
  const replyTarget = selectedThread ? latestInboundMessage(selectedThread) : null;

  function goToPage(nextPage: number) {
    dispatch(fetchMessagesPage({ page: nextPage, pageSize }));
  }

  async function handleSync() {
    try {
      const synced = await dispatch(syncMessages()).unwrap();
      await dispatch(fetchMessagesPage({ page: 1, pageSize }));
      success(synced > 0 ? `Synced ${synced} message(s)` : "No new messages");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Sync failed");
    }
  }

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
      <PageHeader
        title="Messages"
        description="Reply to eBay buyer messages from your dashboard"
        action={
          canManage && (
            <Button size="sm" variant="secondary" onClick={handleSync} disabled={isSyncing}>
              <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
              {isSyncing ? "Syncing…" : "Sync messages"}
            </Button>
          )
        }
      />

      {isFetching && <div className="mb-4 text-sm text-(--color-text-muted)">Loading…</div>}

      <div className="grid grid-cols-1 overflow-hidden rounded-(--radius-card) border border-(--color-border) md:grid-cols-[280px_1fr]">
        <div className="max-h-[600px] overflow-y-auto border-b border-(--color-border) md:border-b-0 md:border-r">
          <ThreadList threads={threads} selectedKey={selectedThread?.key ?? null} onSelect={setSelectedKey} />
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

      <div className="mt-3">
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} />
      </div>
    </div>
  );
}
