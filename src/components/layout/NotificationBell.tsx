"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createTenantClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import {
  fetchNotifications,
  markAllRead,
  dismissOne,
} from "@/store/slices/notificationsSlice";
import {
  isUnread,
  unreadCount,
  synthesizeLowStock,
  isSynthetic,
  NOTIFICATION_LABELS,
} from "@/lib/utils/notifications";

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { error: toastError } = useToast();

  const { items, readIds, readThrough, lowStock } = useAppSelector((s) => s.notifications);
  const ctx = { readThrough, readIds: new Set(readIds), currentUserId };

  // Stored events first (newest first from the query), then synthesized
  // low-stock items, which are a live condition rather than a past event.
  const feed = [...items, ...synthesizeLowStock(lowStock)];
  const count = unreadCount(feed, ctx);

  useEffect(() => {
    dispatch(fetchNotifications({ userId: currentUserId }));
    const id = setInterval(
      () => { dispatch(fetchNotifications({ userId: currentUserId })); },
      POLL_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [dispatch, currentUserId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleMarkAllRead() {
    const now = new Date().toISOString();
    // Optimistic — no rollback on failure. The next 60s poll re-fetches
    // authoritative state from the server and corrects the UI on its own.
    dispatch(markAllRead(now));
    try {
      const supabase = await createTenantClient();
      const { error: dbError } = await supabase
        .from("profiles")
        .update({ notifications_read_through: now })
        .eq("id", currentUserId);
      if (dbError) toastError("Couldn't mark notifications as read");
    } catch {
      toastError("Couldn't mark notifications as read");
    }
  }

  async function handleOpenOne(id: string, link: string | null) {
    // Optimistic — no rollback on failure. The next 60s poll re-fetches
    // authoritative state from the server and corrects the UI on its own.
    dispatch(dismissOne(id));
    // Synthesized low-stock ids are not rows in `notifications`; inserting one
    // would violate notification_reads' foreign key. They clear when stock
    // recovers, so there is nothing to persist.
    if (!isSynthetic(id)) {
      try {
        const supabase = await createTenantClient();
        const { error: dbError } = await supabase
          .from("notification_reads")
          .insert({ notification_id: id, user_id: currentUserId });
        if (dbError) toastError("Couldn't update notification");
      } catch {
        toastError("Couldn't update notification");
      }
    }
    // Navigation happens regardless of whether the read-state write above
    // succeeded — a failed bookkeeping write should not block the user from
    // reaching the page they clicked.
    setOpen(false);
    if (link) router.push(link);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        className="relative p-2 rounded-md hover:bg-[var(--color-surface-subtle)] cursor-pointer"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[0.65rem] font-medium flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-30">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-sm font-medium">Notifications</span>
            {count > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs underline cursor-pointer">
                Mark all read
              </button>
            )}
          </div>

          {feed.length === 0 && (
            <p className="px-3 py-6 text-sm text-center opacity-70">Nothing yet.</p>
          )}

          {feed.map((n) => {
            const unread = isUnread(n, ctx);
            return (
              <button
                key={n.id}
                onClick={() => handleOpenOne(n.id, n.link)}
                className={`w-full text-left px-3 py-2 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-subtle)] cursor-pointer ${unread ? "font-medium" : "opacity-70"}`}
              >
                <span className="block text-[0.65rem] uppercase tracking-wide opacity-60">
                  {NOTIFICATION_LABELS[n.type]}
                </span>
                <span className="block text-sm">{n.title}</span>
                {n.body && <span className="block text-xs opacity-70">{n.body}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
