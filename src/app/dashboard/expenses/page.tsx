"use client";

import { useState, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeExpense } from "./_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { CategoryBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown } from "lucide-react";
import { AddExpenseModal } from "./_components/AddExpenseModal";
import { EditExpenseModal } from "./_components/EditExpenseModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { InvoiceModal } from "@/components/modals/InvoiceModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency, sumAmounts } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import {
  filterExpenses,
  isDefaultFilters,
  DEFAULT_EXPENSE_FILTERS,
  type ExpenseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import type { ExpenseCategory, Expense, Currency } from "@/types";

const CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "other",
];

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function ExpensesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const expenses = useAppSelector((s) => s.expenses.items);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [filters, setFilters] = useState<ExpenseFilters>(DEFAULT_EXPENSE_FILTERS);
  const filtered = useMemo(() => filterExpenses(expenses, filters), [expenses, filters]);
  const hasActive = !isDefaultFilters(filters);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => filtered.filter((e) => selectedIds.has(e.id)),
    [filtered, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : filtered;

  const totals = useMemo(() => {
    const byCurrency = new Map<Currency, number[]>();
    for (const e of filtered) {
      const amounts = byCurrency.get(e.currency) ?? [];
      amounts.push(e.amount);
      byCurrency.set(e.currency, amounts);
    }
    return Array.from(byCurrency.entries()).map(([currency, amounts]) => ({
      currency,
      total: sumAmounts(amounts),
    }));
  }, [filtered]);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  function setFilter<K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = createClient();
    const { error: dbError } = await supabase.from("expenses").delete().eq("id", deleteTarget.id);
    if (dbError) { toastError("Delete failed", dbError.message); return; }
    dispatch(removeExpense(deleteTarget.id));
    const { data: { user } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "delete",
      entityType: "expense",
      entityId: deleteTarget.id,
      metadata: { before: deleteTarget, reason },
    });
    if (log) dispatch(addAuditLog(log));
    success("Expense deleted", `"${deleteTarget.title}" has been removed.`);
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Date",
      sortValue: (e: Expense) => e.date,
      render: (e: Expense) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(e.date)}</span>
      ),
    },
    {
      header: "Title",
      sortValue: (e: Expense) => e.title.toLowerCase(),
      render: (e: Expense) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{e.title}</span>
      ),
    },
    {
      header: "Category",
      sortValue: (e: Expense) => e.category,
      render: (e: Expense) => <CategoryBadge category={e.category} />,
    },
    {
      header: "Vendor",
      sortValue: (e: Expense) => e.vendor?.toLowerCase() ?? "",
      render: (e: Expense) => (
        <span className="text-sm text-[var(--color-text-muted)]">{e.vendor ?? "—"}</span>
      ),
    },
    {
      header: "Amount",
      sortValue: (e: Expense) => e.amount,
      render: (e: Expense) => (
        <span className="text-sm font-semibold text-[var(--color-danger)] tabular-nums">{formatCurrency(e.amount, e.currency)}</span>
      ),
    },
    {
      header: "Actions",
      render: (e: Expense) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(e)} title="Edit">
            <Pencil size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setSelectedIds(new Set([e.id])); setInvoiceOpen(true); }}
            title="Generate invoice for this row"
          >
            <FileDown size={15} />
          </Button>
          {isSuperAdmin && (
            <Button
              size="icon"
              variant="danger"
              onClick={() => { warning("Confirm deletion", `You are about to delete "${e.title}".`); setDeleteTarget(e); }}
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
        title="Expenses"
        description="All business expenses"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setInvoiceOpen(true)}>
              <FileDown size={15} />
              {selectedIds.size > 0 ? `Invoice (${selectedIds.size})` : "Invoice"}
            </Button>
            <Button onClick={() => setAddOpen(true)}>+ Add Expense</Button>
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
        onClear={() => setFilters(DEFAULT_EXPENSE_FILTERS)}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Category</span>
          <select
            value={filters.category}
            onChange={(e) => setFilter("category", e.target.value)}
            className={filterInputCls}
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
      </FilterBar>

      <div className="flex items-center justify-between mb-3 text-sm text-[var(--color-text-muted)]">
        <span>{filtered.length} expense{filtered.length !== 1 ? "s" : ""} shown</span>
        {totals.length > 0 && (
          <span className="font-medium text-[var(--color-text-strong)]">
            Total: {totals.map((t) => formatCurrency(t.total, t.currency)).join(" + ")}
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        keyField="id"
        emptyMessage="No expenses match the current filters."
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <AddExpenseModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={(title) => success("Expense added", `"${title}" was recorded successfully.`)}
      />
      <EditExpenseModal
        key={editTarget?.id ?? "edit-expense"}
        expense={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => success("Expense updated", "Changes have been saved.")}
      />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Expense"
        description={`This will permanently delete "${deleteTarget?.title}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <InvoiceModal
        open={invoiceOpen}
        type="expense"
        items={invoiceItems}
        onClose={() => { setInvoiceOpen(false); setSelectedIds(new Set()); }}
        onSuccess={() => success("Invoice downloaded", `PDF generated for ${invoiceItems.length} record${invoiceItems.length !== 1 ? "s" : ""}.`)}
      />
    </div>
  );
}

