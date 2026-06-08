"use client";

import { useState, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removePurchase } from "./_store/purchasesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown } from "lucide-react";
import { AddPurchaseModal } from "./_components/AddPurchaseModal";
import { EditPurchaseModal } from "./_components/EditPurchaseModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { InvoiceModal } from "@/components/modals/InvoiceModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import {
  filterPurchases,
  isDefaultFilters,
  DEFAULT_PURCHASE_FILTERS,
  type PurchaseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import type { Purchase } from "@/types";

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function PurchasesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const purchases = useAppSelector((s) => s.purchases.items);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [filters, setFilters] = useState<PurchaseFilters>(DEFAULT_PURCHASE_FILTERS);
  const filtered = useMemo(() => filterPurchases(purchases, filters), [purchases, filters]);
  const hasActive = !isDefaultFilters(filters);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => filtered.filter((p) => selectedIds.has(p.id)),
    [filtered, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : filtered;

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  function setFilter<K extends keyof PurchaseFilters>(key: K, value: PurchaseFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = createClient();
    const { error: dbError } = await supabase.from("purchases").delete().eq("id", deleteTarget.id);
    if (dbError) { toastError("Delete failed", dbError.message); return; }
    dispatch(removePurchase(deleteTarget.id));
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
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(p.date)}</span>
      ),
    },
    {
      header: "Product",
      render: (p: Purchase) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{p.product_name}</span>
      ),
    },
    {
      header: "Vendor",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)]">{p.vendor ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{p.quantity}</span>
      ),
    },
    {
      header: "Unit Price",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{formatCurrency(p.unit_price, p.currency)}</span>
      ),
    },
    {
      header: "Total",
      render: (p: Purchase) => (
        <span className="text-sm font-semibold text-[var(--color-warning)] tabular-nums">{formatCurrency(p.total_amount, p.currency)}</span>
      ),
    },
    {
      header: "Actions",
      render: (p: Purchase) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(p)} title="Edit">
            <Pencil size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setSelectedIds(new Set([p.id])); setInvoiceOpen(true); }}
            title="Generate invoice for this row"
          >
            <FileDown size={15} />
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
            <Button variant="secondary" onClick={() => setInvoiceOpen(true)}>
              <FileDown size={15} />
              {selectedIds.size > 0 ? `Invoice (${selectedIds.size})` : "Invoice"}
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
        hasActive={hasActive}
        onClear={() => setFilters(DEFAULT_PURCHASE_FILTERS)}
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

      <DataTable
        columns={columns}
        rows={filtered}
        keyField="id"
        emptyMessage="No purchases match the current filters."
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
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
    </div>
  );
}

