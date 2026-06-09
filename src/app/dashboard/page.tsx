"use client";

import { useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency, calculateNetProfit } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { resolveDateRange, type DatePreset } from "@/lib/utils/filters";
import { CategoryBadge } from "@/components/ui/Badge";
import type { ExpenseCategory } from "@/types";

const RANGE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1";
const inputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer";

/** Describe a resolved range for the page subtitle, handling open-ended custom bounds. */
function describeRange(range: { from: string; to: string } | null): string {
  if (!range) return "all time";
  const from = range.from === "0000-00-00" ? null : range.from;
  const to = range.to === "9999-99-99" ? null : range.to;
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `until ${formatDate(to)}`;
  return "all time";
}

export default function DashboardPage() {
  const sales = useAppSelector((s) => s.sales.items);
  const expenses = useAppSelector((s) => s.expenses.items);
  const purchases = useAppSelector((s) => s.purchases.items);

  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const range = useMemo(
    () => resolveDateRange(preset, dateFrom, dateTo),
    [preset, dateFrom, dateTo]
  );

  const periodSales = useMemo(
    () => (range ? sales.filter((s) => s.date >= range.from && s.date <= range.to) : sales),
    [sales, range]
  );
  const periodExpenses = useMemo(
    () => (range ? expenses.filter((e) => e.date >= range.from && e.date <= range.to) : expenses),
    [expenses, range]
  );
  const periodPurchases = useMemo(
    () => (range ? purchases.filter((p) => p.date >= range.from && p.date <= range.to) : purchases),
    [purchases, range]
  );

  const totalRevenue = periodSales.reduce((s, r) => s + r.total_amount, 0);
  const totalExpenses = periodExpenses.reduce((s, r) => s + r.amount, 0);
  const totalPurchases = periodPurchases.reduce((s, r) => s + r.total_amount, 0);
  const netProfit = calculateNetProfit(totalRevenue, totalExpenses, totalPurchases);

  // VAT position — output VAT (collected from customers via sales) minus
  // input VAT (paid to suppliers via purchases + expenses).
  const vatCollected = periodSales.reduce((s, r) => s + (r.vat_amount ?? 0), 0);
  const vatPaid =
    periodPurchases.reduce((s, r) => s + (r.vat_amount ?? 0), 0) +
    periodExpenses.reduce((s, r) => s + (r.vat_amount ?? 0), 0);
  const vatPosition = vatCollected - vatPaid;
  const hasVatData = vatCollected > 0 || vatPaid > 0;

  const unitsSold = periodSales.reduce((s, r) => s + r.quantity, 0);

  const expensesByCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const e of periodExpenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [periodExpenses]);

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`Summary for ${describeRange(range)}`}
        action={
          <div className="flex items-end gap-3">
            <div>
              <span className={labelCls}>Date Range</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as DatePreset)}
                className={inputCls}
              >
                {RANGE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            {preset === "custom" && (
              <>
                <div>
                  <span className={labelCls}>From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
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
          subtext={netProfit >= 0 ? "Profitable in this period" : "Loss in this period"}
        />
        <StatCard
          label="Orders"
          value={periodSales.length.toLocaleString()}
          subtext={`${unitsSold} unit${unitsSold !== 1 ? "s" : ""} sold`}
          trend="neutral"
        />
      </div>

      {hasVatData && (
        <div
          className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] p-6 mb-8"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <h2 className="text-sm font-semibold text-[var(--color-text-base)] mb-4">VAT Position</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="VAT Collected"
              value={formatCurrency(vatCollected)}
              subtext="Output VAT — charged to customers"
              trend="neutral"
            />
            <StatCard
              label="VAT Paid"
              value={formatCurrency(vatPaid)}
              subtext="Input VAT — purchases & expenses"
              trend="neutral"
            />
            <StatCard
              label={vatPosition >= 0 ? "Due to Government" : "Government Refund"}
              value={formatCurrency(Math.abs(vatPosition))}
              subtext={vatPosition >= 0 ? "Net VAT payable" : "Net VAT reclaimable"}
              trend={vatPosition >= 0 ? "down" : "up"}
            />
          </div>
        </div>
      )}

      {expensesByCategory.length > 0 && (
        <div
          className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] p-6 mb-8"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <h2 className="text-sm font-semibold text-[var(--color-text-base)] mb-4">Expenses by Category</h2>
          <div className="divide-y divide-[var(--color-border)]">
            {expensesByCategory.map(([category, amount]) => (
              <div key={category} className="flex items-center justify-between py-2.5">
                <CategoryBadge category={category} />
                <span className="text-sm font-semibold tabular-nums text-[var(--color-danger)]">
                  {formatCurrency(amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] p-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-base)] mb-1">Quick Start</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Use the sidebar to navigate to Sales, Expenses, and Purchases. Figures
          above reflect the selected date range and use EUR as the base currency.
        </p>
      </div>
    </div>
  );
}
