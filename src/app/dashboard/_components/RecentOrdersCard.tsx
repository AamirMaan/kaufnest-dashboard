"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createTenantClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { PlatformBadge, StatusBadge } from "@/components/ui/Badge";
import type { Sale } from "@/types";
import { avatarClassesFor } from "@/app/dashboard/messages/_lib/avatarColor";
import { RECENT_ORDERS_LIMIT, buyerLabel, initials } from "../_lib/recentOrderDisplay";

type RecentOrder = Pick<Sale, "id" | "platform" | "product_name" | "total_amount" | "currency" | "date" | "status" | "buyer_name">;

/**
 * Latest orders regardless of the picked range. Own query — the Redux
 * `sales` slice holds whichever page the Orders page last fetched.
 */
export function RecentOrdersCard() {
  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const { data, error } = await supabase
        .from("sales")
        .select("id, platform, product_name, total_amount, currency, date, status, buyer_name")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(RECENT_ORDERS_LIMIT);
      if (cancelled) return;
      if (error) {
        console.error("recent orders failed", error);
        setFailed(true);
        setOrders([]);
        return;
      }
      setOrders((data ?? []) as RecentOrder[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-(--color-text-strong)">Recent Orders</h2>
          <p className="text-sm text-(--color-text-muted)">Latest {RECENT_ORDERS_LIMIT} orders</p>
        </div>
        <Link href="/dashboard/sales"
          className="inline-flex items-center gap-1 text-sm font-medium text-(--color-primary-text) hover:underline">
          View all <ArrowUpRight size={16} />
        </Link>
      </div>

      {orders === null ? (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: RECENT_ORDERS_LIMIT }, (_, i) => (
            <div key={i} className="h-12 rounded-[var(--radius-btn)] bg-(--color-border-subtle) animate-pulse" />
          ))}
        </div>
      ) : failed ? (
        <p className="text-sm text-(--color-danger-text)">Couldn&apos;t load recent orders.</p>
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--color-text-faint)">No orders yet</p>
      ) : (
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-(--color-text-muted) border-b border-(--color-border)">
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Platform</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const name = buyerLabel(o);
                return (
                  <tr key={o.id} className="border-b border-(--color-border-subtle) last:border-0 hover:bg-(--color-surface-subtle)">
                    <td className="py-3 pr-3">
                      <Link href={`/dashboard/sales/${o.id}`} className="flex items-center gap-3 min-w-0">
                        <span aria-hidden className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${avatarClassesFor(name)}`}>
                          {initials(name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-(--color-text-strong)">{name}</span>
                          <span className="block truncate text-xs text-(--color-text-muted)">{o.product_name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 pr-3"><PlatformBadge platform={o.platform} /></td>
                    <td className="py-3 pr-3"><StatusBadge status={o.status} /></td>
                    <td className="py-3 pr-3 text-(--color-text-base) whitespace-nowrap">{formatDate(o.date)}</td>
                    <td className="py-3 text-right font-semibold tabular-nums text-(--color-text-strong) whitespace-nowrap">
                      {formatCurrency(o.total_amount, o.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
