import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Purchase } from "@/types";
import Link from "next/link";

export default async function PurchasesPage() {
  const supabase = await createClient();

  const { data: purchases } = await supabase
    .from("purchases")
    .select("*")
    .order("date", { ascending: false })
    .limit(100)
    .returns<Purchase[]>();

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Inventory and stock purchases"
        action={
          <Link
            href="/dashboard/purchases/new"
            className="inline-flex items-center rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            + Add Purchase
          </Link>
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {["Date", "Product", "Vendor", "Qty", "Unit Price", "Total"].map(
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
            {(purchases ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No purchases yet. Add your first purchase.
                </td>
              </tr>
            ) : (
              (purchases ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {formatDate(p.date)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {p.product_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {p.vendor ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">
                    {p.quantity}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">
                    {formatCurrency(p.unit_price, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-amber-600 tabular-nums">
                    {formatCurrency(p.total_amount, p.currency)}
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
