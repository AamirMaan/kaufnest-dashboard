"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector } from "@/store/hooks";
import { hasPermission } from "@/lib/utils/permissions";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { formatCurrency } from "@/lib/utils/currency";
import type { Currency, IntegrationPlatform } from "@/types";
import type { ReviewOrder, ReviewResponse } from "@/app/api/integrations/review/route";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

const ALL_PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

export default function ReviewPage() {
  const router = useRouter();
  const toast = useToast();
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);

  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<IntegrationPlatform | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (role === undefined) return;
    if (
      !role ||
      !tenantPlan ||
      !hasPlatformIntegrations(tenantPlan) ||
      !hasPermission(role, "manage_integrations")
    ) {
      router.replace("/dashboard/integrations");
    }
  }, [role, tenantPlan, router]);

  const isEligible =
    !!role &&
    !!tenantPlan &&
    hasPlatformIntegrations(tenantPlan) &&
    hasPermission(role, "manage_integrations");

  useEffect(() => {
    if (!isEligible) return;
    fetch("/api/integrations/review")
      .then((r) => r.json())
      .then((d: ReviewResponse) => {
        setData(d);
        const first = ALL_PLATFORMS.find((p) => d[p]);
        if (first) setActiveTab(first);
      })
      .catch(() => setData({}))
      .finally(() => setLoading(false));
  }, [isEligible]);

  const platforms = data
    ? ALL_PLATFORMS.filter((p) => data[p])
    : [];

  const activeOrders: ReviewOrder[] = activeTab
    ? (data?.[activeTab]?.orders ?? [])
    : [];

  const unimportedOnTab = activeOrders.filter((o) => !o.imported);

  const allSelectedOnTab =
    unimportedOnTab.length > 0 &&
    unimportedOnTab.every((o) =>
      selected.has(`${activeTab}:${o.external_order_id}`)
    );

  function toggleSelectAll() {
    if (!activeTab) return;
    const next = new Set(selected);
    if (allSelectedOnTab) {
      unimportedOnTab.forEach((o) =>
        next.delete(`${activeTab}:${o.external_order_id}`)
      );
    } else {
      unimportedOnTab.forEach((o) =>
        next.add(`${activeTab}:${o.external_order_id}`)
      );
    }
    setSelected(next);
  }

  function toggleOrder(platform: IntegrationPlatform, orderId: string) {
    const key = `${platform}:${orderId}`;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  async function handleImport() {
    if (!data) return;
    setImportError(null);
    setImporting(true);

    const items: { platform: IntegrationPlatform; order: ReviewOrder }[] = [];
    for (const platform of platforms) {
      for (const order of data[platform]?.orders ?? []) {
        if (selected.has(`${platform}:${order.external_order_id}`)) {
          items.push({ platform, order });
        }
      }
    }

    try {
      const res = await fetch("/api/integrations/review/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const result = (await res.json()) as {
        imported?: number;
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        const message = result.detail ?? result.error ?? "Import failed";
        setImportError(message);
        toast.error("Import failed", message);
        return;
      }

      const importedCount = result.imported ?? 0;
      toast.success(
        "Import complete",
        `${importedCount} order${importedCount === 1 ? "" : "s"} imported.`
      );

      // Flip imported rows in local state so they grey out immediately
      setData((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        for (const platform of platforms) {
          if (updated[platform]) {
            updated[platform] = {
              orders: updated[platform]!.orders.map((o) =>
                selected.has(`${platform}:${o.external_order_id}`)
                  ? { ...o, imported: true }
                  : o
              ),
            };
          }
        }
        return updated;
      });
      setSelected(new Set());
      router.refresh();
    } catch {
      const message = "Network error — please try again";
      setImportError(message);
      toast.error("Import failed", message);
    } finally {
      setImporting(false);
    }
  }

  const cardCls =
    "rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]";

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">
          Loading orders…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/integrations"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-base)] mb-3"
        >
          <ChevronLeft size={14} />
          Integrations
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-text-strong)]">
          Review Orders
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Select orders to import into your dashboard. Last 90 days shown.
        </p>
      </div>

      {/* Platform API errors */}
      {data?.errors && Object.keys(data.errors).length > 0 && (
        <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]">
          {Object.entries(data.errors).map(([p, msg]) => (
            <p key={p}>
              {PLATFORM_LABELS[p as IntegrationPlatform] ?? p}: {msg}
            </p>
          ))}
        </div>
      )}

      {platforms.length === 0 ? (
        <div className={`${cardCls} p-8 text-center`}>
          <p className="text-sm text-[var(--color-text-muted)]">
            No connected platforms. Connect eBay or Amazon first.
          </p>
        </div>
      ) : (
        <>
          {/* Platform tabs */}
          <div className="flex gap-1 border-b border-[var(--color-border)]">
            {platforms.map((platform) => {
              const unimported =
                data?.[platform]?.orders.filter((o) => !o.imported).length ?? 0;
              return (
                <button
                  key={platform}
                  onClick={() => {
                    setActiveTab(platform);
                    setSelected(new Set());
                  }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === platform
                      ? "border-[var(--color-primary)] text-[var(--color-text-strong)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-base)]"
                  }`}
                >
                  {PLATFORM_LABELS[platform]}
                  {unimported > 0 && (
                    <span className="ml-1.5 text-xs font-normal">
                      ({unimported})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Import error banner */}
          {importError && (
            <p className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] rounded-[var(--radius-btn)] px-3 py-2">
              {importError}
            </p>
          )}

          {/* Orders table */}
          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelectedOnTab}
                      onChange={toggleSelectAll}
                      disabled={unimportedOnTab.length === 0}
                      className="cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  {["Date", "Order ID", "Product", "Qty", "Amount", "Status"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] py-3 pr-4"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {activeOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-sm text-[var(--color-text-muted)]"
                    >
                      No orders found in the last 90 days.
                    </td>
                  </tr>
                ) : (
                  activeOrders.map((order) => {
                    const key = `${activeTab}:${order.external_order_id}`;
                    return (
                      <tr
                        key={order.external_order_id}
                        className={
                          order.imported
                            ? "opacity-40"
                            : "hover:bg-[var(--color-surface-subtle)] transition-colors"
                        }
                      >
                        <td className="p-3">
                          {order.imported ? (
                            <span className="text-xs text-[var(--color-text-faint)]">
                              ✓
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              onChange={() =>
                                activeTab &&
                                toggleOrder(activeTab, order.external_order_id)
                              }
                              className="cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                          {order.date}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs text-[var(--color-text-faint)]">
                          {order.external_order_id}
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-base)]">
                          {order.product_name}
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                          {order.quantity}
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-base)]">
                          {formatCurrency(
                            order.total_amount,
                            (order.currency as Currency) ?? "EUR"
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge label={order.status} variant="default" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Import button */}
          <div className="flex justify-end">
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
            >
              {importing
                ? "Importing…"
                : `Import selected (${selected.size})`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
