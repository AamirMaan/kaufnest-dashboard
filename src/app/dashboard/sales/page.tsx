"use client";

import { useState, useMemo, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeSale, fetchSalesPage } from "./_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { PlatformBadge, StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown, Download, Upload } from "lucide-react";
import Link from "next/link";
import { AddSaleModal } from "./_components/AddSaleModal";
import { EditSaleModal } from "./_components/EditSaleModal";
import { ImportSalesModal } from "./_components/ImportSalesModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { InvoiceModal } from "@/components/modals/InvoiceModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency, sumAmounts } from "@/lib/utils/currency";
import { exportToCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import {
  isDefaultFilters,
  isRevenueSale,
  DEFAULT_SALES_FILTERS,
  getPresetRange,
  sanitizeIlikeSearchTerm,
  type SalesFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import { updateProduct } from "@/app/dashboard/inventory/_store/inventorySlice";
import { ORDER_STATUSES, statusLabel } from "./_components/orderStatus";
import type { Platform, Sale, Currency, Product } from "@/types";

const PLATFORMS: Platform[] = ["amazon", "ebay", "etsy", "shopify", "other"];

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function SalesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const sales = useAppSelector((s) => s.sales.items);
  const page = useAppSelector((s) => s.sales.page);
  const pageSize = useAppSelector((s) => s.sales.pageSize);
  const total = useAppSelector((s) => s.sales.total);
  const isFetching = useAppSelector((s) => s.sales.isFetching);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");
  const hasDeleteOverride = useAppSelector(
    (s) => s.currentUser.profile?.permission_overrides?.includes("delete_sale") ?? false
  );
  const canDelete = isSuperAdmin || hasDeleteOverride;

  const [filters, setFilters] = useState<SalesFilters>(DEFAULT_SALES_FILTERS);
  const hasActive = !isDefaultFilters(filters);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => sales.filter((s) => selectedIds.has(s.id)),
    [sales, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : sales;

  const excludedCount = useMemo(() => sales.filter((s) => !isRevenueSale(s)).length, [sales]);

  // Summary computed from current page items only — labelled "(this page)" to
  // make clear these are page-scoped totals, not all-time aggregates.
  const summary = useMemo(() => {
    const byCurrency = new Map<Currency, { gross: number[]; vat: number[] }>();
    for (const s of sales) {
      if (!isRevenueSale(s)) continue;
      const entry = byCurrency.get(s.currency) ?? { gross: [], vat: [] };
      entry.gross.push(s.total_amount);
      if (s.vat_amount != null) entry.vat.push(s.vat_amount);
      byCurrency.set(s.currency, entry);
    }
    return Array.from(byCurrency.entries()).map(([currency, { gross, vat }]) => ({
      currency,
      gross: sumAmounts(gross),
      vat: sumAmounts(vat),
    }));
  }, [sales]);
  const hasVat = summary.some((s) => s.vat > 0);

  // Status options built from current page + known preset statuses.
  // The "all" statuses dropdown is approximate — it only shows what's on the
  // current page plus presets — but this is acceptable for v1.
  const statusOptions = useMemo(() => {
    const set = new Set<string>(ORDER_STATUSES);
    for (const s of sales) set.add(s.status);
    return Array.from(set);
  }, [sales]);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Sale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ── Filter helpers ────────────────────────────────────────────────────────

  /** Fire a server-side fetch and reset to page 1 when filters change. */
  const applyFilters = useCallback(
    (nextFilters: SalesFilters) => {
      dispatch(fetchSalesPage({ page: 1, pageSize, filters: nextFilters }));
    },
    [dispatch, pageSize]
  );

  function setFilter<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    applyFilters(next);
  }

  function clearFilters() {
    setFilters(DEFAULT_SALES_FILTERS);
    applyFilters(DEFAULT_SALES_FILTERS);
  }

  // ── CSV export — fetches ALL matching rows (no range cap except safety 5000) ─

  async function handleExport() {
    const supabase = await createTenantClient();
    let query = supabase
      .from("sales")
      .select("*")
      .order("date", { ascending: false })
      .limit(5000);

    const range =
      filters.preset === "custom"
        ? { from: filters.dateFrom || "0000-00-00", to: filters.dateTo || "9999-99-99" }
        : getPresetRange(filters.preset);
    if (range && filters.preset !== "all") {
      query = query.gte("date", range.from).lte("date", range.to);
    }
    if (filters.platform !== "all") query = query.eq("platform", filters.platform);
    if (filters.currency !== "all") query = query.eq("currency", filters.currency);
    if (filters.status !== "all") query = query.eq("status", filters.status);

    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike."%${term}%",external_order_id.ilike."%${term}%",description.ilike."%${term}%"`
      );
    }

    const { data: allRows } = await query;
    if (!allRows || allRows.length === 0) return;

    const headers = ["date", "product_name", "platform", "quantity", "unit_price", "total_amount", "currency", "vat_rate", "vat_amount", "status", "description", "shipping_cost", "shipping_charged", "advertising_fee", "platform_fee"];
    const rows = (allRows as Sale[]).map((s) => [
      s.date, s.product_name, s.platform, s.quantity, s.unit_price, s.total_amount,
      s.currency, s.vat_rate ?? "", s.vat_amount ?? "", s.status, s.description ?? "",
      s.shipping_cost ?? "", s.shipping_charged ?? "", s.advertising_fee ?? "", s.platform_fee ?? "",
    ]);
    exportToCsv(`sales-${new Date().toISOString().split("T")[0]}`, headers, rows);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = await createTenantClient();
    const { error: dbError } = await supabase.from("sales").delete().eq("id", deleteTarget.id);
    if (dbError) { toastError("Delete failed", dbError.message); return; }
    dispatch(removeSale(deleteTarget.id));

    // Re-fetch the affected product — the delete trigger restored its stock.
    if (deleteTarget.product_id) {
      const { data: fresh } = await supabase
        .from("products").select("*").eq("id", deleteTarget.product_id).single<Product>();
      if (fresh) dispatch(updateProduct(fresh));
    }

    const { data: { user } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "delete",
      entityType: "sale",
      entityId: deleteTarget.id,
      metadata: { before: deleteTarget, reason },
    });
    if (log) dispatch(addAuditLog(log));
    success("Order deleted", `"${deleteTarget.product_name}" has been removed.`);
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Date",
      sortValue: (s: Sale) => s.date,
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(s.date)}</span>
      ),
    },
    {
      header: "Product",
      sortValue: (s: Sale) => s.product_name.toLowerCase(),
      render: (s: Sale) => (
        <Link
          href={`/dashboard/sales/${s.id}`}
          className="text-sm font-medium text-(--color-text-strong) hover:text-(--color-primary) hover:underline"
        >
          {s.product_name}
        </Link>
      ),
    },
    {
      header: "Platform",
      sortValue: (s: Sale) => s.platform,
      render: (s: Sale) => <PlatformBadge platform={s.platform} />,
    },
    {
      header: "Status",
      sortValue: (s: Sale) => s.status,
      render: (s: Sale) => <StatusBadge status={s.status} />,
    },
    {
      header: "Qty",
      sortValue: (s: Sale) => s.quantity,
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{s.quantity}</span>
      ),
    },
    {
      header: "Unit Price",
      sortValue: (s: Sale) => s.unit_price,
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{formatCurrency(s.unit_price, s.currency)}</span>
      ),
    },
    {
      header: "Total",
      sortValue: (s: Sale) => s.total_amount,
      render: (s: Sale) => (
        <span className="text-sm font-semibold text-[var(--color-success)] tabular-nums">{formatCurrency(s.total_amount, s.currency)}</span>
      ),
    },
    {
      header: "VAT",
      sortValue: (s: Sale) => s.vat_amount ?? -1,
      render: (s: Sale) =>
        s.vat_rate != null ? (
          <div className="tabular-nums">
            <span className="text-sm text-[var(--color-text-base)]">{s.vat_rate}%</span>
            <span className="block text-xs text-[var(--color-text-muted)]">{formatCurrency(s.vat_amount ?? 0, s.currency)}</span>
          </div>
        ) : (
          <span className="text-sm text-[var(--color-text-muted)]">—</span>
        ),
    },
    {
      header: "Fees",
      sortValue: (s: Sale) => (s.shipping_cost ?? 0) + (s.advertising_fee ?? 0) + (s.platform_fee ?? 0),
      render: (s: Sale) => {
        const feesTotal = (s.shipping_cost ?? 0) + (s.advertising_fee ?? 0) + (s.platform_fee ?? 0);
        return s.shipping_cost == null && s.advertising_fee == null && s.platform_fee == null ? (
          <span className="text-sm text-[var(--color-text-muted)]">—</span>
        ) : (
          <span className="text-sm text-[var(--color-text-base)] tabular-nums">{formatCurrency(feesTotal, s.currency)}</span>
        );
      },
    },
    {
      header: "Actions",
      render: (s: Sale) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(s)} title="Edit">
            <Pencil size={15} className="text-blue-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setSelectedIds(new Set([s.id])); setInvoiceOpen(true); }}
            title="Generate invoice for this row"
          >
            <FileDown size={15} className="text-violet-500" />
          </Button>
          {canDelete && (
            <Button
              size="icon"
              variant="danger"
              onClick={() => { warning("Confirm deletion", `You are about to delete "${s.product_name}".`); setDeleteTarget(s); }}
              title="Delete"
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Revenue from all platforms"
        action={
          <div className="flex items-center gap-2">
            <Button variant="invoice" onClick={() => setInvoiceOpen(true)}>
              <FileDown size={15} />
              {selectedIds.size > 0 ? `Invoice (${selectedIds.size})` : "Invoice"}
            </Button>
            <Button variant="export" onClick={handleExport} disabled={total === 0}>
              <Download size={15} />
              Export
            </Button>
            <Button variant="import" onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              Import
            </Button>
            <Button onClick={() => setAddOpen(true)}>+ Add Order</Button>
          </div>
        }
      />

      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
        onCurrencyChange={(v) => setFilter("currency", v)}
        searchValue={filters.search}
        onSearchChange={(v) => setFilter("search", v)}
        searchPlaceholder="Search product, order ID, description…"
        hasActive={hasActive}
        onClear={clearFilters}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Platform</span>
          <select
            value={filters.platform}
            onChange={(e) => setFilter("platform", e.target.value)}
            className={filterInputCls}
          >
            <option value="all">All Platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Status</span>
          <select
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value)}
            className={filterInputCls}
          >
            <option value="all">All Statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
      </FilterBar>

      {/* Loading overlay — subtle opacity fade while a page fetch is in flight */}
      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="flex items-start justify-between mb-3 text-sm">
          <span className="text-(--color-text-muted) pt-0.5">
            {total} order{total !== 1 ? "s" : ""} total
          </span>
          {(summary.length > 0 || excludedCount > 0) && (
            <div className="text-right space-y-0.5">
              {summary.length > 0 && (
                hasVat ? (
                  <>
                    <p className="font-medium text-(--color-text-strong)">
                      Gross (this page): {summary.map((s) => formatCurrency(s.gross, s.currency)).join(" + ")}
                    </p>
                    <p className="text-(--color-text-muted)">
                      VAT (this page): {summary.map((s) => formatCurrency(s.vat, s.currency)).join(" + ")}
                    </p>
                    <p className="font-medium text-(--color-text-strong)">
                      Net (this page): {summary.map((s) => formatCurrency(s.gross - s.vat, s.currency)).join(" + ")}
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-(--color-text-strong)">
                    Total (this page): {summary.map((s) => formatCurrency(s.gross, s.currency)).join(" + ")}
                  </p>
                )
              )}
              {excludedCount > 0 && (
                <p className="text-xs text-(--color-text-muted)">
                  {excludedCount} returned/cancelled order{excludedCount !== 1 ? "s" : ""} excluded from totals
                </p>
              )}
            </div>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={sales}
          keyField="id"
          emptyMessage="No orders match the current filters."
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchSalesPage({ page: p, pageSize, filters }))}
          onPageSizeChange={(s) => dispatch(fetchSalesPage({ page: 1, pageSize: s, filters }))}
        />
      </div>

      <AddSaleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={(name) => success("Order added", `"${name}" was recorded successfully.`)}
      />
      <EditSaleModal
        key={editTarget?.id ?? "edit-sale"}
        sale={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => success("Order updated", "Changes have been saved.")}
      />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Order"
        description={`This will permanently delete "${deleteTarget?.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <InvoiceModal
        open={invoiceOpen}
        type="sale"
        items={invoiceItems}
        onClose={() => { setInvoiceOpen(false); setSelectedIds(new Set()); }}
        onSuccess={() => success("Invoice downloaded", `PDF generated for ${invoiceItems.length} record${invoiceItems.length !== 1 ? "s" : ""}.`)}
      />
      <ImportSalesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={({ inserted, skippedRows, refundsApplied, refundsSkipped, refundsExceeded, refundsAlreadyApplied }) => {
          const parts: string[] = [];
          if (inserted > 0) parts.push(`${inserted} order${inserted !== 1 ? "s" : ""} imported successfully.`);
          if (refundsApplied > 0) parts.push(`${refundsApplied} refund${refundsApplied !== 1 ? "s" : ""} applied.`);
          if (refundsSkipped > 0) parts.push(`${refundsSkipped} refund${refundsSkipped !== 1 ? "s" : ""} skipped — no matching order found.`);
          if (refundsExceeded > 0) parts.push(`${refundsExceeded} refund${refundsExceeded !== 1 ? "s" : ""} skipped — larger than the matched order, which was left unchanged.`);
          if (refundsAlreadyApplied > 0) parts.push(`${refundsAlreadyApplied} refund${refundsAlreadyApplied !== 1 ? "s" : ""} already applied — no change.`);
          if (skippedRows > 0) parts.push(`${skippedRows} row${skippedRows !== 1 ? "s" : ""} skipped.`);
          const description = parts.length > 0 ? parts.join(" ") : "Nothing to import.";
          if (inserted === 0 && refundsApplied === 0) {
            warning("No orders imported", description);
          } else {
            success("Import complete", description);
          }
        }}
      />
    </div>
  );
}
