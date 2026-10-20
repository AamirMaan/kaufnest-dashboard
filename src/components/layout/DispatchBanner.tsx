"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { usePlan } from "@/store/usePlan";
import { useAccess } from "@/store/useAccess";
import { hasAdvancedInventory } from "@/lib/plans/entitlements";
import { createTenantClient } from "@/lib/supabase/client";
import { requestDispatchFlush } from "@/lib/utils/dispatchFlush";
import { dispatchBannerLines, shouldRequestFlush, type DispatchQueueRow } from "./dispatchQueue";

const DEBOUNCE_MS = 2000;
/** Queue re-poll, same cadence as NotificationBell. */
const POLL_MS = 60_000;

/**
 * Persistent "orders to dispatch" banner for a location's dispatcher (057).
 * Also the single place that nudges the dispatch email flush: on mount and,
 * debounced, whenever the sales slice records a write (summaryVersion is
 * bumped by addSale/updateSale/removeSale — every client write path). The
 * queue refetches on mount, after those writes, and every POLL_MS (not on
 * navigation — that ran the RPC for every advanced-inventory user on every
 * page change); the poll never flushes (see shouldRequestFlush), and users
 * without Orders view never flush (the route would 403).
 * Renders nothing for plans without advanced inventory or an empty queue.
 */
export function DispatchBanner() {
  const { ent } = usePlan();
  const entitled = !!ent && hasAdvancedInventory(ent);
  const summaryVersion = useAppSelector((s) => s.sales.summaryVersion);
  const [pollTick, setPollTick] = useState(0);
  const canViewOrders = useAccess().can("orders", 1);
  const lastFlushedVersion = useRef<number | null>(null);
  const [rows, setRows] = useState<DispatchQueueRow[]>([]);

  useEffect(() => {
    if (!entitled) return;
    const id = setInterval(() => setPollTick((t) => t + 1), POLL_MS);
    return () => clearInterval(id);
  }, [entitled]);

  useEffect(() => {
    if (!entitled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (shouldRequestFlush(lastFlushedVersion.current, summaryVersion, canViewOrders)) {
        lastFlushedVersion.current = summaryVersion;
        requestDispatchFlush();
      }
      try {
        const supabase = await createTenantClient();
        const { data, error } = await supabase.rpc("my_dispatch_queue");
        if (!cancelled) setRows(error ? [] : ((data ?? []) as DispatchQueueRow[]));
      } catch {
        if (!cancelled) setRows([]);
      }
    }, summaryVersion === 0 ? 0 : DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [entitled, summaryVersion, pollTick, canViewOrders]);

  const lines = dispatchBannerLines(rows);
  if (!entitled || lines.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-6 rounded-[var(--radius-card)] border border-[var(--color-warning)] bg-[var(--color-warning-bg)] p-4 text-sm text-[var(--color-warning-text)]"
    >
      <div className="flex items-start gap-3">
        <PackageCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l.key}>
              You have{" "}
              <Link href={l.href} className="font-semibold underline hover:no-underline">
                {l.count}
              </Link>{" "}
              to dispatch from <strong>{l.location}</strong>.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
