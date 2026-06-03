"use client";

import { useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { CategoryBadge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Expense } from "@/types";
import Link from "next/link";

export default function ExpensesPage() {
  const expenses = useAppSelector((s) => s.expenses.items);

  const columns = [
    {
      header: "Date",
      render: (e: Expense) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">
          {formatDate(e.date)}
        </span>
      ),
    },
    {
      header: "Title",
      render: (e: Expense) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">
          {e.title}
        </span>
      ),
    },
    {
      header: "Category",
      render: (e: Expense) => <CategoryBadge category={e.category} />,
    },
    {
      header: "Vendor",
      render: (e: Expense) => (
        <span className="text-sm text-[var(--color-text-muted)]">
          {e.vendor ?? "—"}
        </span>
      ),
    },
    {
      header: "Amount",
      render: (e: Expense) => (
        <span className="text-sm font-semibold text-[var(--color-danger)] tabular-nums">
          {formatCurrency(e.amount, e.currency)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="All business expenses"
        action={
          <Link href="/dashboard/expenses/new">
            <Button>+ Add Expense</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={expenses}
        keyField="id"
        emptyMessage="No expenses yet. Add your first expense."
      />
    </div>
  );
}
