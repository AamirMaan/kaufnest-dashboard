"use client";

import { useState } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeExpense } from "@/store/slices/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { CategoryBadge } from "@/components/ui/Badge";
import { AddExpenseModal } from "@/components/modals/AddExpenseModal";
import { EditExpenseModal } from "@/components/modals/EditExpenseModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Expense } from "@/types";

export default function ExpensesPage() {
  const dispatch = useAppDispatch();
  const expenses = useAppSelector((s) => s.expenses.items);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = createClient();
    await supabase.from("expenses").delete().eq("id", deleteTarget.id);
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
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Date",
      render: (e: Expense) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(e.date)}</span>
      ),
    },
    {
      header: "Title",
      render: (e: Expense) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{e.title}</span>
      ),
    },
    {
      header: "Category",
      render: (e: Expense) => <CategoryBadge category={e.category} />,
    },
    {
      header: "Vendor",
      render: (e: Expense) => (
        <span className="text-sm text-[var(--color-text-muted)]">{e.vendor ?? "—"}</span>
      ),
    },
    {
      header: "Amount",
      render: (e: Expense) => (
        <span className="text-sm font-semibold text-[var(--color-danger)] tabular-nums">{formatCurrency(e.amount, e.currency)}</span>
      ),
    },
    {
      header: "Actions",
      render: (e: Expense) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditTarget(e)}>Edit</Button>
          {isSuperAdmin && (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(e)}>Delete</Button>
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
        action={<Button onClick={() => setAddOpen(true)}>+ Add Expense</Button>}
      />
      <DataTable columns={columns} rows={expenses} keyField="id" emptyMessage="No expenses yet. Add your first expense." />
      <AddExpenseModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditExpenseModal expense={editTarget} onClose={() => setEditTarget(null)} />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Expense"
        description={`This will permanently delete "${deleteTarget?.title}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
