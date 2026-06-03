import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { CategoryBadge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Expense } from "@/types";
import Link from "next/link";

export default async function ExpensesPage() {
  const supabase = await createClient();

  const { data: expenses } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false })
    .limit(100)
    .returns<Expense[]>();

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="All business expenses"
        action={
          <Link
            href="/dashboard/expenses/new"
            className="inline-flex items-center rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            + Add Expense
          </Link>
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {["Date", "Title", "Category", "Vendor", "Amount"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(expenses ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  No expenses yet. Add your first expense.
                </td>
              </tr>
            ) : (
              (expenses ?? []).map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {formatDate(e.date)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {e.title}
                  </td>
                  <td className="px-4 py-3">
                    <CategoryBadge category={e.category} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {e.vendor ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-red-600 tabular-nums">
                    {formatCurrency(e.amount, e.currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
