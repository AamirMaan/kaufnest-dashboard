"use client";

import { CATEGORY_LABELS } from "@/components/ui/Badge";
import type { Currency, ExpenseCategory } from "@/types";
import { pctChange, stackedSeries, topCategoryShare } from "../_lib/overviewCharts";
import type { ExpensesOverview, OverviewTimeseries } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { StackedBars } from "./StackedBars";
import { useChartKit } from "./useChartKit";

function categoryName(key: string): string {
  // expenses.category is unconstrained text — unknown values show as-is.
  return CATEGORY_LABELS[key as ExpenseCategory] ?? key;
}

export function ExpensesCard({
  expenses,
  timeseries,
  currency,
}: {
  expenses: ExpensesOverview | null;
  timeseries: OverviewTimeseries | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  const total = expenses?.total ?? 0;
  const top = topCategoryShare(expenses?.byCategory ?? [], total);
  const series = stackedSeries(timeseries?.months ?? [], "expenses_by_category");

  return (
    <ChartCard
      title="Expenses"
      headline={kit.money(total)}
      change={pctChange(total, timeseries?.previous?.expenses)}
      goodWhen="down"
      meta={
        top
          ? `Largest: ${categoryName(top.category)} ${kit.money(top.amount)} (${top.share.toFixed(0)}%)`
          : undefined
      }
      empty={series.keys.length === 0}
    >
      <StackedBars series={series} kit={kit} labelFor={categoryName} />
    </ChartCard>
  );
}
