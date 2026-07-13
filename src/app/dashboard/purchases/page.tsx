"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removePurchase, fetchPurchasesPage } from "./_store/purchasesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown, Download, Upload } from "lucide-react";
import { AddPurchaseModal } from "./_components/AddPurchaseModal";
import { EditPurchaseModal } from "./_components/EditPurchaseModal";
import { ImportPurchasesModal } from "./_components/ImportPurchasesModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { InvoiceModal } from "@/components/modals/InvoiceModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency, sumAmounts } from "@/lib/utils/currency";
import { exportToCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import {
  isDefaultFilters,
  DEFAULT_PURCHASE_FILTERS,
  getPresetRange,
  sanitizeIlikeSearchTerm,
  type PurchaseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import { updateProduct } from "@/app/dashboard/inventory/_store/inventorySlice";
import type { Purchase, Currency, Product } from "@/types";

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function PurchasesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const purchases = useAppSelector((s) => s.purchases.items);
  const page = useAppSelector((s) => s.purchases.page);
  const pageSize = useAppSelector((s) => s.purchases.pageSize);
  const total = useAppSelector((s) => s.purchases.total);
  const isFetching = useAppSelector((s) => s.purchases.isFetching);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [filters, setFilters] = useState<PurchaseFilters>(DEFAULT_PURCHASE_FILTERS);
  const hasActive = !isDefaultFilters(filters);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => purchases.filter((p) => selectedIds.has(p.id)),
    [purchases, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : purchases;

  // Summary computed from current page items only — labelled "(this page)" to
  // make clear these are page-scoped totals, not all-time aggregates.
  const summary = useMemo(() => {
    const byCurrency = new Map<Currency, { gross: number[]; vat: number[] }>();
    for (const p of purchases) {
      const entry = byCurrency.get(p.currency) ?? { gross: [], vat: [] };
      entry.gross.push(p.total_amount);
      if (p.vat_amount != null) entry.vat.push(p.vat_amount);
      byCurrency.set(p.currency, entry);
    }
    return Array.from(byCurrency.entries()).map(([currency, { gross, vat }]) => ({
      currency,
      gross: sumAmounts(gross),
      vat: sumAmounts(vat),
    }));
  }, [purchases]);
  const hasVat = summary.some((s) => s.vat > 0);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ── Filter helpers ────────────────────────────────────────────────────────

  /** Fire a server-side fetch and reset to page 1 when filters change. */
  const applyFilters = useCallback(
    (nextFilters: PurchaseFilters) => {
      dispatch(fetchPurchasesPage({ page: 1, pageSize, filters: nextFilters }));
    },
    [dispatch, pageSize]
  );

  function setFilter<K extends keyof PurchaseFilters>(key: K, value: PurchaseFilters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    applyFilters(next);
  }

  function clearFilters() {
    setFilters(DEFAULT_PURCHASE_FILTERS);
    applyFilters(DEFAULT_PURCHASE_FILTERS);
  }

  // ── CSV export — fetches ALL matching rows (no range cap except safety 5000) ─

  async function handleExport() {
    const supabase = await createTenantClient();
    let query = supabase
      .from("purchases")
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
    if (filters.vendor.trim() !== "") {
      query = query.ilike("vendor", `%${filters.vendor.trim()}%`);
    }
    if (filters.currency !== "all") query = query.eq("currency", filters.currency);

    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike."%${term}%",vendor.ilike."%${term}%",description.ilike."%${term}%"`
      );
    }

    const { data: allRows } = await query;
    if (!allRows || allRows.length === 0) return;

    const headers = ["date", "product_name", "vendor", "quantity", "unit_price", "total_amount", "currency", "vat_rate", "vat_amount", "description"];
    const rows = (allRows as Purchase[]).map((p) => [
      p.date, p.product_name, p.vendor ?? "", p.quantity, p.unit_price, p.total_amount,
      p.currency, p.vat_rate ?? "", p.vat_amount ?? "", p.description ?? "",
    ]);
    exportToCsv(`purchases-${new Date().toISOString().split("T")[0]}`, headers, rows);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = await createTenantClient();
    const { error: dbError } = await supabase.from("purchases").delete().eq("id", deleteTarget.id);
    if (dbError) { toastError("Delete failed", dbError.message); return; }
    dispatch(removePurchase(deleteTarget.id));

    // Re-fetch the affected product — the delete trigger reversed its stock contribution.
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
      entityType: "purchase",
      entityId: deleteTarget.id,
      metadata: { before: deleteTarget, reason },
    });
    if (log) dispatch(addAuditLog(log));
    success("Purchase deleted", `"${deleteTarget.product_name}" has been removed.`);
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Date",
      sortValue: (p: Purchase) => p.date,
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(p.date)}</span>
      ),
    },
    {
      header: "Product",
      sortValue: (p: Purchase) => p.product_name.toLowerCase(),
      render: (p: Purchase) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[var(--color-text-strong)]">{p.product_name}</span>
          {p.sale_id && (
            <Link
              href={`/dashboard/sales/${p.sale_id}`}
              className="inline-flex items-center gap-1 text-xs text-(--color-primary) hover:underline w-fit"
              onClick={(e) => e.stopPropagation()}
            >
              Linked to order →
            </Link>
          )}
        </div>
      ),
    },
    {
      header: "Vendor",
      sortValue: (p: Purchase) => p.vendor?.toLowerCase() ?? "",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)]">{p.vendor ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      sortValue: (p: Purchase) => p.quantity,
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{p.quantity}</span>
      ),
    },
    {
      header: "Unit Price",
      sortValue: (p: Purchase) => p.unit_price,
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{formatCurrency(p.unit_price, p.currency)}</span>
      ),
    },
    {
      header: "Total",
      sortValue: (p: Purchase) => p.total_amount,
      render: (p: Purchase) => (
        <span className="text-sm font-semibold text-[var(--color-warning)] tabular-nums">{formatCurrency(p.total_amount, p.currency)}</span>
      ),
    },
    {
      header: "VAT",
      sortValue: (p: Purchase) => p.vat_amount ?? -1,
      render: (p: Purchase) =>
        p.vat_rate != null ? (
          <div className="tabular-nums">
            <span className="text-sm text-[var(--color-text-base)]">{p.vat_rate}%</span>
            <span className="block text-xs text-[var(--color-text-muted)]">{formatCurrency(p.vat_amount ?? 0, p.currency)}</span>
          </div>
        ) : (
          <span className="text-sm text-[var(--color-text-muted)]">—</span>
        ),
    },
    {
      header: "Actions",
      render: (p: Purchase) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(p)} title="Edit">
            <Pencil size={15} className="text-blue-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setSelectedIds(new Set([p.id])); setInvoiceOpen(true); }}
            title="Generate invoice for this row"
          >
            <FileDown size={15} className="text-violet-500" />
          </Button>
          {isSuperAdmin && (
            <Button
              size="icon"
              variant="danger"
              onClick={() => { warning("Confirm deletion", `You are about to delete "${p.product_name}".`); setDeleteTarget(p); }}
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
        title="Purchases"
        description="Inventory and stock purchases"
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
            <Button onClick={() => setAddOpen(true)}>+ Add Purchase</Button>
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
        searchPlaceholder="Search product, vendor, description…"
        hasActive={hasActive}
        onClear={clearFilters}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Vendor</span>
          <input
            type="text"
            value={filters.vendor}
            onChange={(e) => setFilter("vendor", e.target.value)}
            placeholder="Search vendor…"
            className={filterInputCls}
          />
        </div>
      </FilterBar>

      {/* Loading overlay — subtle opacity fade while a page fetch is in flight */}
      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="flex items-start justify-between mb-3 text-sm">
          <span className="text-(--color-text-muted) pt-0.5">
            {total} purchase{total !== 1 ? "s" : ""} total
          </span>
          {summary.length > 0 && (
            <div className="text-right space-y-0.5">
              {hasVat ? (
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
              )}
            </div>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={purchases}
          keyField="id"
          emptyMessage="No purchases match the current filters."
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchPurchasesPage({ page: p, pageSize, filters }))}
          onPageSizeChange={(s) => dispatch(fetchPurchasesPage({ page: 1, pageSize: s, filters }))}
        />
      </div>

      <AddPurchaseModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={(name) => success("Purchase added", `"${name}" was recorded successfully.`)}
      />
      <EditPurchaseModal
        key={editTarget?.id ?? "edit-purchase"}
        purchase={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => success("Purchase updated", "Changes have been saved.")}
      />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Purchase"
        description={`This will permanently delete "${deleteTarget?.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <InvoiceModal
        open={invoiceOpen}
        type="purchase"
        items={invoiceItems}
        onClose={() => { setInvoiceOpen(false); setSelectedIds(new Set()); }}
        onSuccess={() => success("Invoice downloaded", `PDF generated for ${invoiceItems.length} record${invoiceItems.length !== 1 ? "s" : ""}.`)}
      />
      <ImportPurchasesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={(count) => success("Import complete", `${count} purchase${count !== 1 ? "s" : ""} imported successfully.`)}
      />
    </div>
  );
}
