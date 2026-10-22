"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { hasPlatformIntegrations } from "@/lib/plans/entitlements";
import { usePlan } from "@/store/usePlan";
import { formatCurrency, computeFeeFromPercent } from "@/lib/utils/currency";
import { integrationErrorMessage } from "@/lib/utils/integrationErrors";
import type { Currency, IntegrationPlatform, Purchase } from "@/types";
import type { ReviewOrder, ReviewResponse } from "@/app/api/integrations/review/route";
import { failedAccountCount } from "./_lib/failedAccountCount";
import { seedOrderFees } from "./_lib/seedOrderFees";
import { accountsInOrders, filterByAccount } from "./_lib/reviewAccounts";
import { matchInventory } from "./_lib/matchInventory";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

const ALL_PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

export default function ReviewPage() {
  const router = useRouter();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const { can } = useAccess();
  const { ent } = usePlan();

  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<IntegrationPlatform | null>(null);
  // Connection id, or "all". Reset whenever the platform tab changes.
  const [accountFilter, setAccountFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [purchaseCosts, setPurchaseCosts] = useState<
    Record<string, { price: string; vendor: string }>
  >({});
  const [orderFees, setOrderFees] = useState<
    Record<string, { advertisingFee: string; platformFee: string }>
  >({});
  // The user's explicit picks: external_order_id -> products.id ("" = "Not linked").
  // An order with no entry here shows its auto-match suggestion instead.
  const [productLinks, setProductLinks] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const [bulkAdFeePct, setBulkAdFeePct] = useState("");
  const [bulkPlatformFeePct, setBulkPlatformFeePct] = useState("");

  function updatePurchaseCost(
    key: string,
    field: "price" | "vendor",
    value: string
  ) {
    setPurchaseCosts((prev) => ({
      ...prev,
      [key]: {
        price: prev[key]?.price ?? "",
        vendor: prev[key]?.vendor ?? "",
        [field]: value,
      },
    }));
  }

  function updateOrderFee(
    key: string,
    field: "advertisingFee" | "platformFee",
    value: string
  ) {
    setOrderFees((prev) => ({
      ...prev,
      [key]: {
        advertisingFee: prev[key]?.advertisingFee ?? "",
        platformFee: prev[key]?.platformFee ?? "",
        [field]: value,
      },
    }));
  }

  /**
   * Fills advertisingFee/platformFee for every currently-selected order with
   * `pct`% of that order's own total_amount — a quick way to apply a known
   * eBay/Amazon fee rate across a whole batch instead of typing it per row.
   * Overwrites whatever's already in those rows' fields; per-row values can
   * still be hand-edited afterward for any order that's an exception.
   */
  function applyBulkFeePercent(field: "advertisingFee" | "platformFee", pct: string) {
    const pctNum = parseFloat(pct);
    if (isNaN(pctNum) || !activeTab) return;
    setOrderFees((prev) => {
      const next = { ...prev };
      for (const order of activeOrders) {
        const key = order.external_order_id;
        if (!selected.has(`${activeTab}:${key}`)) continue;
        const amount = computeFeeFromPercent(order.total_amount, pctNum);
        next[key] = {
          advertisingFee: next[key]?.advertisingFee ?? "",
          platformFee: next[key]?.platformFee ?? "",
          [field]: amount.toFixed(2),
        };
      }
      return next;
    });
  }

  function changeProductLink(orderId: string, productId: string) {
    setProductLinks((prev) => ({ ...prev, [orderId]: productId }));
  }

  function toggleExpanded(orderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  // Suggested inventory item per not-yet-imported order (pure; the user's own
  // pick in productLinks always wins, including an explicit "Not linked").
  const suggestions = useMemo(() => {
    const found: Record<string, { productId: string; reason: "sku" | "name" }> = {};
    if (!data) return found;
    for (const platform of ALL_PLATFORMS) {
      for (const order of data[platform]?.orders ?? []) {
        if (order.imported) continue;
        const match = matchInventory(order, products);
        if (match) found[order.external_order_id] = match;
      }
    }
    return found;
  }, [data, products]);

  function linkedProductId(orderId: string): string {
    return orderId in productLinks ? productLinks[orderId] : (suggestions[orderId]?.productId ?? "");
  }


  // Computed once per render as a plain boolean — `can` is a fresh function
  // reference every render (useAccess() isn't memoized), so depending on it
  // directly in the effect below re-ran it on every render.
  const isEligible =
    !!ent &&
    hasPlatformIntegrations(ent) &&
    can("integrations", 2);

  useEffect(() => {
    if (!isEligible) router.replace("/dashboard/integrations");
  }, [isEligible, router]);

  useEffect(() => {
    if (!isEligible) return;
    fetch("/api/integrations/review")
      .then((r) => r.json())
      .then((d: ReviewResponse) => {
        setData(d);
        setOrderFees((prev) => seedOrderFees(d, prev));
        const first = ALL_PLATFORMS.find((p) => d[p]);
        if (first) {
          setActiveTab(first);
          setAccountFilter("all");
        }
      })
      .catch(() => setData({}))
      .finally(() => setLoading(false));
  }, [isEligible]);

  const platforms = data
    ? ALL_PLATFORMS.filter((p) => data[p])
    : [];

  const tabOrders: ReviewOrder[] = activeTab
    ? (data?.[activeTab]?.orders ?? [])
    : [];
  const tabAccounts = accountsInOrders(tabOrders);
  // Account picker + column only matter when the tab mixes accounts.
  const showAccounts = tabAccounts.length > 1;
  // Falls back to "all" if the chosen account dropped out after a re-fetch.
  const effectiveAccount = tabAccounts.some((a) => a.id === accountFilter) ? accountFilter : "all";
  const activeOrders = filterByAccount(tabOrders, effectiveAccount);

  const unimportedOnTab = activeOrders.filter((o) => !o.imported);

  const hasImportedOrders = platforms.some((p) =>
    (data?.[p]?.orders ?? []).some((o) => o.imported)
  );

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

    const links: Record<string, string> = {};
    for (const { order } of items) {
      const productId = linkedProductId(order.external_order_id);
      if (productId) links[order.external_order_id] = productId;
    }

    try {
      const res = await fetch("/api/integrations/review/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, purchaseCosts, orderFees, productLinks: links }),
      });
      const result = (await res.json()) as {
        imported?: number;
        createdPurchases?: Purchase[];
        purchaseWarning?: string;
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        const message = integrationErrorMessage(result.error, result.detail ?? result.error ?? "Import failed");
        setImportError(message);
        toast.error("Import failed", message);
        return;
      }

      // Sync linked purchases into Redux store so the Purchases page is current
      for (const purchase of result.createdPurchases ?? []) {
        dispatch(addPurchase(purchase));
      }

      const importedCount = result.imported ?? 0;
      toast.success(
        "Import complete",
        `${importedCount} order${importedCount === 1 ? "" : "s"} imported.`
      );

      if (result.purchaseWarning) {
        toast.error("Purchase costs not saved", result.purchaseWarning);
      }

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

  async function handleSyncStatuses() {
    setImportError(null);
    setSyncing(true);

    try {
      const freshRes = await fetch("/api/integrations/review");

      if (!freshRes.ok) {
        const message = await freshRes
          .json()
          .then((body: { error?: string; detail?: string }) => body.detail ?? body.error)
          .catch(() => undefined);
        setImportError(message ?? "Failed to refresh order data");
        toast.error("Sync failed", message ?? "Failed to refresh order data");
        return;
      }

      const fresh = (await freshRes.json()) as ReviewResponse;
      const failedAccounts = failedAccountCount(fresh);

      const items: { platform: IntegrationPlatform; order: ReviewOrder }[] = [];
      for (const platform of ALL_PLATFORMS) {
        for (const order of fresh[platform]?.orders ?? []) {
          if (order.imported) items.push({ platform, order });
        }
      }

      if (items.length === 0) {
        setData(fresh);
        setOrderFees((prev) => seedOrderFees(fresh, prev));
        toast.info("Nothing to sync", "No previously-imported orders found.");
        return;
      }

      const res = await fetch("/api/integrations/review/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const result = (await res.json()) as { imported?: number; error?: string; detail?: string };

      if (!res.ok) {
        const message = integrationErrorMessage(result.error, result.detail ?? result.error ?? "Sync failed");
        setImportError(message);
        toast.error("Sync failed", message);
        return;
      }

      setData(fresh);
      setOrderFees((prev) => seedOrderFees(fresh, prev));
      const syncedCount = result.imported ?? 0;
      if (failedAccounts > 0) {
        toast.warning(
          "Statuses partially synced",
          `${syncedCount} order${syncedCount === 1 ? "" : "s"} synced. Could not refresh ${failedAccounts} account${failedAccounts === 1 ? "" : "s"} — try again later.`
        );
      } else {
        toast.success(
          "Statuses synced",
          `${syncedCount} order${syncedCount === 1 ? "" : "s"} synced from eBay/Amazon.`
        );
      }
      router.refresh();
    } catch {
      const message = "Network error — please try again";
      setImportError(message);
      toast.error("Sync failed", message);
    } finally {
      setSyncing(false);
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
          {Object.entries(data.errors).map(([connectionId, msg]) => (
            <p key={connectionId}>{msg}</p>
          ))}
        </div>
      )}

      {data?.warnings && Object.keys(data.warnings).length > 0 && (
        <div className="rounded-[var(--radius-btn)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
          {Object.entries(data.warnings).map(([connectionId, msg]) => (
            <p key={connectionId}>{msg}</p>
          ))}
        </div>
      )}

      {data?.pausedAccounts && data.pausedAccounts.length > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Not shown (paused): {data.pausedAccounts.join(", ")}. Manage accounts on the Integrations page.
        </p>
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
                    setAccountFilter("all");
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

          {showAccounts && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-text-muted)]">Account</span>
              <select
                value={effectiveAccount}
                onChange={(e) => {
                  setAccountFilter(e.target.value);
                  // Don't import rows the user can no longer see.
                  setSelected(new Set());
                }}
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
              >
                <option value="all">All accounts</option>
                {tabAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Bulk fee-percent toolbar — fills advertisingFee/platformFee for
              every selected order as pct% of that order's own total_amount.
              Per-row cells stay editable afterward for any exception. */}
          <div className={`${cardCls} flex flex-wrap items-center gap-3 p-3 text-sm`}>
            <span className="text-[var(--color-text-muted)]">
              Apply fee % to {selected.size} selected order{selected.size === 1 ? "" : "s"}:
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--color-text-muted)]">Ad Fee</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={bulkAdFeePct}
                onChange={(e) => setBulkAdFeePct(e.target.value)}
                placeholder="%"
                className="w-16 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={selected.size === 0 || bulkAdFeePct.trim() === ""}
                onClick={() => applyBulkFeePercent("advertisingFee", bulkAdFeePct)}
              >
                Apply
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--color-text-muted)]">Platform Fee</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={bulkPlatformFeePct}
                onChange={(e) => setBulkPlatformFeePct(e.target.value)}
                placeholder="%"
                className="w-16 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={selected.size === 0 || bulkPlatformFeePct.trim() === ""}
                onClick={() => applyBulkFeePercent("platformFee", bulkPlatformFeePct)}
              >
                Apply
              </Button>
            </div>
          </div>

          {/* Orders table */}
          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-2 py-3 w-10" aria-label="Row details" />
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelectedOnTab}
                      onChange={toggleSelectAll}
                      disabled={unimportedOnTab.length === 0}
                      className="cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  {["Date", "Order ID", ...(showAccounts ? ["Account"] : []), "Product", "Qty", "Amount", "Status"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] py-3 pr-4"
                      >
                        {h}
                      </th>
                    )
                  )}
                  <th className="px-3 py-2 text-left text-xs font-medium text-(--color-text-muted) whitespace-nowrap">
                    Inventory item
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-(--color-text-muted) whitespace-nowrap">
                    Purchase Cost
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-(--color-text-muted) whitespace-nowrap">
                    Vendor
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-(--color-text-muted) whitespace-nowrap">
                    Ad Fee
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-(--color-text-muted) whitespace-nowrap">
                    Platform Fee
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {activeOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={showAccounts ? 14 : 13}
                      className="py-8 text-center text-sm text-[var(--color-text-muted)]"
                    >
                      No orders found in the last 90 days.
                    </td>
                  </tr>
                ) : (
                  activeOrders.map((order) => {
                    const key = `${activeTab}:${order.external_order_id}`;
                    const isOpen = expanded.has(order.external_order_id);
                    return (
                      <Fragment key={order.external_order_id}>
                      <tr
                        className={
                          order.imported
                            ? "opacity-40"
                            : "hover:bg-[var(--color-surface-subtle)] transition-colors"
                        }
                      >
                        <td className="px-2 py-3 w-10">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(order.external_order_id)}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? "Collapse row" : "Expand row"}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-(--radius-btn) text-(--color-text-muted) hover:bg-(--color-border-subtle) hover:text-(--color-text-strong) cursor-pointer transition-colors duration-150"
                          >
                            <ChevronDown
                              size={16}
                              className={`transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                        </td>
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
                        {showAccounts && (
                          <td className="p-3 text-xs text-[var(--color-text-muted)]">
                            {order.account_name}
                          </td>
                        )}
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
                        <td className="px-3 py-2">
                          {order.imported ? (
                            <span className="text-xs text-[var(--color-text-faint)]">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <Select
                                aria-label={`Inventory item for ${order.product_name}`}
                                value={linkedProductId(order.external_order_id)}
                                onChange={(e) =>
                                  changeProductLink(order.external_order_id, e.target.value)
                                }
                                className="w-52 !py-1"
                              >
                                <option value="">Not linked</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.sku ? `${p.name} · ${p.sku}` : p.name}
                                  </option>
                                ))}
                              </Select>
                              {!(order.external_order_id in productLinks) && suggestions[order.external_order_id] && (
                                <Badge
                                  label={`Auto-matched (${suggestions[order.external_order_id].reason === "sku" ? "SKU" : "name"})`}
                                  variant="default"
                                />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={purchaseCosts[order.external_order_id]?.price ?? ""}
                            onChange={(e) =>
                              updatePurchaseCost(order.external_order_id, "price", e.target.value)
                            }
                            placeholder="Cost"
                            className="w-24 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={purchaseCosts[order.external_order_id]?.vendor ?? ""}
                            onChange={(e) =>
                              updatePurchaseCost(order.external_order_id, "vendor", e.target.value)
                            }
                            placeholder="Vendor"
                            className="w-32 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={orderFees[order.external_order_id]?.advertisingFee ?? ""}
                            onChange={(e) =>
                              updateOrderFee(order.external_order_id, "advertisingFee", e.target.value)
                            }
                            placeholder="0.00"
                            className="w-24 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={orderFees[order.external_order_id]?.platformFee ?? ""}
                            onChange={(e) =>
                              updateOrderFee(order.external_order_id, "platformFee", e.target.value)
                            }
                            placeholder="0.00"
                            className="w-24 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-(--color-surface-subtle) border-t border-(--color-border)">
                          <td colSpan={showAccounts ? 14 : 13} className="px-6 py-5">
                            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
                              {[
                                ["Variant", order.variant],
                                ["SKU", order.sku],
                                ["Marketplace", order.marketplace],
                                ["Buyer", order.shipping?.buyerName],
                                ["Country", order.shipping?.country],
                                ["Order ID", order.external_order_id],
                              ].map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <dt className="text-sm font-semibold text-(--color-text-strong)">{label}</dt>
                                  <dd className="mt-1 text-sm text-(--color-text-muted) break-words">
                                    {value || "—"}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Sync + Import buttons */}
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={handleSyncStatuses}
              disabled={!hasImportedOrders || syncing || importing}
            >
              {syncing ? "Syncing…" : "Sync Statuses"}
            </Button>
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || importing || syncing}
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
