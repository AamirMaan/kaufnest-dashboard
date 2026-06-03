import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { PlatformBadge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Sale } from "@/types";
import Link from "next/link";

export default async function SalesPage() {
  const supabase = await createClient();

  const { data: sales } = await supabase
    .from("sales")
    .select("*")
    .order("date", { ascending: false })
    .limit(100)
    .returns<Sale[]>();

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Revenue from all platforms"
        action={
          <Link
            href="/dashboard/sales/new"
            className="inline-flex items-center rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            + Add Sale
          </Link>
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {["Date", "Product", "Platform", "Qty", "Unit Price", "Total"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(sales ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No sales yet. Add your first sale.
                </td>
              </tr>
            ) : (
              (sales ?? []).map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {formatDate(s.date)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {s.product_name}
                  </td>
                  <td className="px-4 py-3">
                    <PlatformBadge platform={s.platform} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">
                    {s.quantity}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">
                    {formatCurrency(s.unit_price, s.currency)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-emerald-600 tabular-nums">
                    {formatCurrency(s.total_amount, s.currency)}
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
