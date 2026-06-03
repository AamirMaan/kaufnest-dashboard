import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency, calculateNetProfit } from "@/lib/utils/currency";
import { getMonthRange } from "@/lib/utils/date";
import type { Expense, Purchase, Sale } from "@/types";

export default async function DashboardPage() {
  const supabase = await createClient();

  const now = new Date();
  const { from: firstDay, to: lastDay } = getMonthRange(
    now.getFullYear(),
    now.getMonth() + 1
  );

  const [{ data: sales }, { data: expenses }, { data: purchases }] =
    await Promise.all([
      supabase
        .from("sales")
        .select("total_amount, currency")
        .gte("date", firstDay)
        .lte("date", lastDay)
        .returns<Pick<Sale, "total_amount" | "currency">[]>(),
      supabase
        .from("expenses")
        .select("amount, currency")
        .gte("date", firstDay)
        .lte("date", lastDay)
        .returns<Pick<Expense, "amount" | "currency">[]>(),
      supabase
        .from("purchases")
        .select("total_amount, currency")
        .gte("date", firstDay)
        .lte("date", lastDay)
        .returns<Pick<Purchase, "total_amount" | "currency">[]>(),
    ]);

  const totalRevenue = (sales ?? []).reduce((s, r) => s + r.total_amount, 0);
  const totalExpenses = (expenses ?? []).reduce((s, r) => s + r.amount, 0);
  const totalPurchases = (purchases ?? []).reduce((s, r) => s + r.total_amount, 0);
  const netProfit = calculateNetProfit(totalRevenue, totalExpenses, totalPurchases);

  const monthLabel = now.toLocaleString("de-DE", { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`Summary for ${monthLabel}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Revenue"
          value={formatCurrency(totalRevenue)}
          trend="up"
        />
        <StatCard
          label="Expenses"
          value={formatCurrency(totalExpenses)}
          trend="down"
        />
        <StatCard
          label="Purchases"
          value={formatCurrency(totalPurchases)}
          trend="down"
        />
        <StatCard
          label="Net Profit"
          value={formatCurrency(netProfit)}
          trend={netProfit >= 0 ? "up" : "down"}
          subtext={netProfit >= 0 ? "Profitable this month" : "Loss this month"}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Quick Start</h2>
        <p className="text-sm text-slate-500">
          Use the sidebar to navigate to Sales, Expenses, and Purchases. All
          figures above are for the current calendar month and use EUR as the
          base currency.
        </p>
      </div>
    </div>
  );
}
