"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { removeExpense, fetchExpensesPage, fetchExpensesSummary } from "./_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { SummaryTiles } from "@/components/ui/SummaryTiles";
import { CategoryBadge, CATEGORY_LABELS } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, FileDown, Download, Upload } from "lucide-react";
import { AddExpenseModal } from "./_components/AddExpenseModal";
import { EditExpenseModal } from "./_components/EditExpenseModal";
import { ImportExpensesModal } from "./_components/ImportExpensesModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { InvoiceModal } from "@/components/modals/InvoiceModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { exportToCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import { fetchAllRows } from "@/lib/utils/fetchAllRows";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
import {
  isDefaultFilters,
  DEFAULT_EXPENSE_FILTERS,
  type ExpenseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import { buildExpensesTiles } from "./_lib/expensesSummaryTiles";
import { expensesFilterParams } from "./_store/expensesFilterParams";
import type { ExpenseCategory, Expense } from "@/types";

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
  const summaryRows = useAppSelector((s) => s.expenses.summary);
  const summaryLoading = useAppSelector((s) => s.expenses.summaryLoading);
  const summaryError = useAppSelector((s) => s.expenses.summaryError);
  const summaryVersion = useAppSelector((s) => s.expenses.summaryVersion);
  const { can } = useAccess();
  const canEdit = can("expenses", 2);
  const canDelete = can("expenses", 3);

  const [filters, setFilters] = useState<ExpenseFilters>(DEFAULT_EXPENSE_FILTERS);
  const hasActive = !isDefaultFilters(filters);

  // Filtered totals for the tiles — refetch when filters change or after any
  // add/edit/delete (summaryVersion), but NOT on page/sort change.
  useEffect(() => {
    dispatch(fetchExpensesSummary(filters));
  }, [dispatch, filters, summaryVersion]);

  const summaryTiles = useMemo(
    () => buildExpensesTiles(summaryRows, (c) => CATEGORY_LABELS[c] ?? c),
    [summaryRows]
  );

  useEffect(() => {
    if (summaryError) toastError("Couldn't load expense totals");
  }, [summaryError, toastError]);

  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const year = await fetchEarliestYear(async () => {
        const { data } = await supabase
          .from("expenses")
          .select("date")
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.date ?? null;
      });
      if (!cancelled) setEarliestYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedItems = useMemo(
    () => expenses.filter((e) => selectedIds.has(e.id)),
    [expenses, selectedIds]
  );
  const invoiceItems = selectedItems.length > 0 ? selectedItems : expenses;

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

  // Atomic — see sales/page.tsx's setPeriod and FilterBar's SKILL.md entry for why three separate setFilter calls would silently drop two of three fields.
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    const next = { ...filters, preset, dateFrom, dateTo };
    setFilters(next);
    applyFilters(next);
  }

  function clearFilters() {
    setFilters(DEFAULT_EXPENSE_FILTERS);
    applyFilters(DEFAULT_EXPENSE_FILTERS);
  }

  // ── CSV export — fetches ALL matching rows, paginated past the server's
  // Max Rows cap (see @/lib/utils/fetchAllRows), up to a 5 000-row safety cap ─

  async function handleExport() {
    const supabase = await createTenantClient();
    const p = expensesFilterParams(filters);

    const allRows = await fetchAllRows<Expense>(async (from, to) => {
      let query = supabase
        .from("expenses")
        .select("*", { count: "exact" })
        .order("date", { ascending: false })
        .range(from, to);

      if (p.p_from) query = query.gte("date", p.p_from);
      if (p.p_to) query = query.lte("date", p.p_to);
      if (p.p_category) query = query.eq("category", p.p_category);
      if (p.p_currency) query = query.eq("currency", p.p_currency);
      if (p.p_pattern) {
        query = query.or(
          `title.ilike."${p.p_pattern}",vendor.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}",invoice_number.ilike."${p.p_pattern}"`
        );
      }

      return query.returns<Expense[]>();
    }, 5000);

    if (allRows.length === 0) return;

    const headers = ["date", "title", "category", "vendor", "amount", "currency", "vat_rate", "vat_amount", "description"];
    const rows = allRows.map((e) => [
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
          {canEdit && (
            <Button size="icon" variant="ghost" onClick={() => setEditTarget(e)} title="Edit">
              <Pencil size={15} className="text-blue-500" />
            </Button>
          )}
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
            {can("expenses", 2) && (
              <>
                <Button variant="import" onClick={() => setImportOpen(true)}>
                  <Upload size={15} />
                  Import
                </Button>
                <Button onClick={() => setAddOpen(true)}>+ Add Expense</Button>
              </>
            )}
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
        earliestYear={earliestYear}
        onPeriodChange={setPeriod}
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
        <SummaryTiles tiles={summaryTiles} loading={summaryLoading} error={summaryError} className="mb-3" />

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
