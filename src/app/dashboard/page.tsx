"use client";

import { useAppSelector } from "@/store/hooks";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency, calculateNetProfit } from "@/lib/utils/currency";
import { getMonthRange } from "@/lib/utils/date";

export default function DashboardPage() {
  const sales = useAppSelector((s) => s.sales.items);
  const expenses = useAppSelector((s) => s.expenses.items);
  const purchases = useAppSelector((s) => s.purchases.items);

  const now = new Date();
  const { from: firstDay, to: lastDay } = getMonthRange(
    now.getFullYear(),
    now.getMonth() + 1
  );

  const thisMonthSales = sales.filter((s) => s.date >= firstDay && s.date <= lastDay);
  const thisMonthExpenses = expenses.filter((e) => e.date >= firstDay && e.date <= lastDay);
  const thisMonthPurchases = purchases.filter((p) => p.date >= firstDay && p.date <= lastDay);

  const totalRevenue = thisMonthSales.reduce((s, r) => s + r.total_amount, 0);
  const totalExpenses = thisMonthExpenses.reduce((s, r) => s + r.amount, 0);
  const totalPurchases = thisMonthPurchases.reduce((s, r) => s + r.total_amount, 0);
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

      <div
        className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] p-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-base)] mb-1">Quick Start</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Use the sidebar to navigate to Sales, Expenses, and Purchases. All
          figures above are for the current calendar month and use EUR as the
          base currency.
        </p>
      </div>
    </div>
  );
}
