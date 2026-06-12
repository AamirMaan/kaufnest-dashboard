"use client";

import { useState, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeSale } from "./_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { PlatformBadge, StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown, Download, Upload } from "lucide-react";
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
  filterSales,
  isDefaultFilters,
  DEFAULT_SALES_FILTERS,
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
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [filters, setFilters] = useState<SalesFilters>(DEFAULT_SALES_FILTERS);
  const filtered = useMemo(() => filterSales(sales, filters), [sales, filters]);
  const hasActive = !isDefaultFilters(filters);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => filtered.filter((s) => selectedIds.has(s.id)),
    [filtered, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : filtered;

  const returnedCount = useMemo(() => filtered.filter((s) => s.status === "returned").length, [filtered]);

  const summary = useMemo(() => {
    const byCurrency = new Map<Currency, { gross: number[]; vat: number[] }>();
    for (const s of filtered) {
      if (s.status === "returned") continue;
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
  }, [filtered]);
  const hasVat = summary.some((s) => s.vat > 0);

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

  function handleExport() {
    const headers = ["date", "product_name", "platform", "quantity", "unit_price", "total_amount", "currency", "vat_rate", "vat_amount", "status", "description"];
    const rows = filtered.map((s) => [
      s.date, s.product_name, s.platform, s.quantity, s.unit_price, s.total_amount,
      s.currency, s.vat_rate ?? "", s.vat_amount ?? "", s.status, s.description ?? "",
    ]);
    exportToCsv(`sales-${new Date().toISOString().split("T")[0]}`, headers, rows);
  }

  function setFilter<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

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
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{s.product_name}</span>
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
      header: "Actions",
      render: (s: Sale) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(s)} title="Edit">
            <Pencil size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setSelectedIds(new Set([s.id])); setInvoiceOpen(true); }}
            title="Generate invoice for this row"
          >
            <FileDown size={15} />
          </Button>
          {isSuperAdmin && (
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
            <Button variant="secondary" onClick={() => setInvoiceOpen(true)}>
              <FileDown size={15} />
              {selectedIds.size > 0 ? `Invoice (${selectedIds.size})` : "Invoice"}
            </Button>
            <Button variant="secondary" onClick={handleExport} disabled={filtered.length === 0}>
              <Download size={15} />
              Export
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
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
        hasActive={hasActive}
        onClear={() => setFilters(DEFAULT_SALES_FILTERS)}
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

      <div className="flex items-start justify-between mb-3 text-sm">
        <span className="text-[var(--color-text-muted)] pt-0.5">
          {filtered.length} order{filtered.length !== 1 ? "s" : ""} shown
        </span>
        {(summary.length > 0 || returnedCount > 0) && (
          <div className="text-right space-y-0.5">
            {summary.length > 0 && (
              hasVat ? (
                <>
                  <p className="font-medium text-[var(--color-text-strong)]">
                    Gross: {summary.map((s) => formatCurrency(s.gross, s.currency)).join(" + ")}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    VAT: {summary.map((s) => formatCurrency(s.vat, s.currency)).join(" + ")}
                  </p>
                  <p className="font-medium text-[var(--color-text-strong)]">
                    Net: {summary.map((s) => formatCurrency(s.gross - s.vat, s.currency)).join(" + ")}
                  </p>
                </>
              ) : (
                <p className="font-medium text-[var(--color-text-strong)]">
                  Total: {summary.map((s) => formatCurrency(s.gross, s.currency)).join(" + ")}
                </p>
              )
            )}
            {returnedCount > 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {returnedCount} returned order{returnedCount !== 1 ? "s" : ""} excluded from totals
              </p>
            )}
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        keyField="id"
        emptyMessage="No orders match the current filters."
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
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
        onSuccess={(count) => success("Import complete", `${count} order${count !== 1 ? "s" : ""} imported successfully.`)}
      />
    </div>
  );
}
