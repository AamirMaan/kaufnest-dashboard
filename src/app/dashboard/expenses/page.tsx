"use client";

import { useState, useMemo, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeExpense, fetchExpensesPage } from "./_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { CategoryBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown, Download, Upload } from "lucide-react";
import { AddExpenseModal } from "./_components/AddExpenseModal";
import { EditExpenseModal } from "./_components/EditExpenseModal";
import { ImportExpensesModal } from "./_components/ImportExpensesModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { InvoiceModal } from "@/components/modals/InvoiceModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency, sumAmounts } from "@/lib/utils/currency";
import { exportToCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import {
  isDefaultFilters,
  DEFAULT_EXPENSE_FILTERS,
  getPresetRange,
  sanitizeIlikeSearchTerm,
  type ExpenseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import type { ExpenseCategory, Expense, Currency } from "@/types";

const CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "other",
];

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function ExpensesPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const expenses = useAppSelector((s) => s.expenses.items);
  const page = useAppSelector((s) => s.expenses.page);
  const pageSize = useAppSelector((s) => s.expenses.pageSize);
  const total = useAppSelector((s) => s.expenses.total);
  const isFetching = useAppSelector((s) => s.expenses.isFetching);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");
  const hasDeleteOverride = useAppSelector(
    (s) => s.currentUser.profile?.permission_overrides?.includes("delete_expense") ?? false
  );
  const canDelete = isSuperAdmin || hasDeleteOverride;

  const [filters, setFilters] = useState<ExpenseFilters>(DEFAULT_EXPENSE_FILTERS);
  const hasActive = !isDefaultFilters(filters);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => expenses.filter((e) => selectedIds.has(e.id)),
    [expenses, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : expenses;

  // Summary computed from current page items only — labelled "(this page)" to
  // make clear these are page-scoped totals, not all-time aggregates.
  const summary = useMemo(() => {
    const byCurrency = new Map<Currency, { gross: number[]; vat: number[] }>();
    for (const e of expenses) {
      const entry = byCurrency.get(e.currency) ?? { gross: [], vat: [] };
      entry.gross.push(e.amount);
      if (e.vat_amount != null) entry.vat.push(e.vat_amount);
      byCurrency.set(e.currency, entry);
    }
    return Array.from(byCurrency.entries()).map(([currency, { gross, vat }]) => ({
      currency,
      gross: sumAmounts(gross),
      vat: sumAmounts(vat),
    }));
  }, [expenses]);
  // `!== 0`, not `> 0`: credit notes carry NEGATIVE input tax, so a page (or a
  // filtered period) made up only of refunds sums to a negative VAT total that
  // is still real VAT to report. `> 0` hid the whole summary for exactly those
  // rows. Same reasoning as `hasVatData` on the Overview page.
  const hasVat = summary.some((s) => s.vat !== 0);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ── Filter helpers ────────────────────────────────────────────────────────

  /** Fire a server-side fetch and reset to page 1 when filters change. */
  const applyFilters = useCallback(
    (nextFilters: ExpenseFilters) => {
      dispatch(fetchExpensesPage({ page: 1, pageSize, filters: nextFilters }));
    },
    [dispatch, pageSize]
  );

  function setFilter<K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    applyFilters(next);
  }

  function clearFilters() {
    setFilters(DEFAULT_EXPENSE_FILTERS);
    applyFilters(DEFAULT_EXPENSE_FILTERS);
  }

  // ── CSV export — fetches ALL matching rows (no range cap except safety 5000) ─

  async function handleExport() {
    const supabase = await createTenantClient();
    let query = supabase
      .from("expenses")
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
    if (filters.category !== "all") query = query.eq("category", filters.category);
    if (filters.currency !== "all") query = query.eq("currency", filters.currency);

    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `title.ilike."%${term}%",vendor.ilike."%${term}%",description.ilike."%${term}%",invoice_number.ilike."%${term}%"`
      );
    }

    const { data: allRows } = await query;
    if (!allRows || allRows.length === 0) return;

    const headers = ["date", "title", "category", "vendor", "amount", "currency", "vat_rate", "vat_amount", "description"];
    const rows = (allRows as Expense[]).map((e) => [
      e.date, e.title, e.category, e.vendor ?? "", e.amount,
      e.currency, e.vat_rate ?? "", e.vat_amount ?? "", e.description ?? "",
    ]);
    exportToCsv(`expenses-${new Date().toISOString().split("T")[0]}`, headers, rows);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = await createTenantClient();
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
        <span className="text-sm text-(--color-text-muted) whitespace-nowrap">{formatDate(e.date)}</span>
      ),
    },
    {
      header: "Title",
      sortValue: (e: Expense) => e.title.toLowerCase(),
      render: (e: Expense) => (
        <span className="text-sm font-medium text-(--color-text-strong)">{e.title}</span>
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
        <span className="text-sm text-(--color-text-muted)">{e.vendor ?? "—"}</span>
      ),
    },
    {
      header: "Amount",
      sortValue: (e: Expense) => e.amount,
      // Colour follows the SIGN, matching the Overview page's Expenses-by-
      // Category list: a credit note (`Erstattung von Verkäufergebühren`,
      // −123.81) is money coming back, so it reads green, not red. Rendering
      // every amount in `--color-danger` made a refund look like a cost on the
      // primary screen users actually meet these rows on.
      render: (e: Expense) => (
        <span
          className={`text-sm font-semibold tabular-nums ${
            e.amount < 0 ? "text-(--color-success)" : "text-(--color-danger)"
          }`}
        >
          {formatCurrency(e.amount, e.currency)}
        </span>
      ),
    },
    {
      header: "VAT",
      // `-1` used to mean "no VAT sorts below everything", which stopped being
      // true once credit notes brought NEGATIVE vat_amounts: a real −19.77
      // sorted below the sentinel, interleaving no-VAT rows between the credit
      // notes and the ordinary ones. NEGATIVE_INFINITY is the only sentinel a
      // real figure cannot collide with, and it keeps the "nulls last when
      // ascending" behaviour the -1 was chosen for — no comparator change
      // needed, so `DataTable`'s shared sort stays untouched.
      sortValue: (e: Expense) => e.vat_amount ?? Number.NEGATIVE_INFINITY,
      render: (e: Expense) =>
        e.vat_rate != null ? (
          <div className="tabular-nums">
            <span className="text-sm text-(--color-text-base)">{e.vat_rate}%</span>
            <span className="block text-xs text-(--color-text-muted)">{formatCurrency(e.vat_amount ?? 0, e.currency)}</span>
          </div>
        ) : (
          <span className="text-sm text-(--color-text-muted)">—</span>
        ),
    },
    {
      header: "Actions",
      render: (e: Expense) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(e)} title="Edit">
            <Pencil size={15} className="text-blue-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setSelectedIds(new Set([e.id])); setInvoiceOpen(true); }}
            title="Generate invoice for this row"
          >
            <FileDown size={15} className="text-violet-500" />
          </Button>
          {canDelete && (
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
        searchValue={filters.search}
        onSearchChange={(v) => setFilter("search", v)}
        searchPlaceholder="Search title, vendor, invoice #, description…"
        hasActive={hasActive}
        onClear={clearFilters}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Category</span>
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

      {/* Loading overlay — subtle opacity fade while a page fetch is in flight */}
      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="flex items-start justify-between mb-3 text-sm">
          <span className="text-(--color-text-muted) pt-0.5">
            {total} expense{total !== 1 ? "s" : ""} total
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
          rows={expenses}
          keyField="id"
          emptyMessage="No expenses match the current filters."
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchExpensesPage({ page: p, pageSize, filters }))}
          onPageSizeChange={(s) => dispatch(fetchExpensesPage({ page: 1, pageSize: s, filters }))}
        />
      </div>

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
      <ImportExpensesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={(count) => success("Import complete", `${count} expense${count !== 1 ? "s" : ""} imported successfully.`)}
      />
    </div>
  );
}
