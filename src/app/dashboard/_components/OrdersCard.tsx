"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import { monthLabel, pctChange, returnRate, sumMonths } from "../_lib/overviewCharts";
import type { OverviewTimeseries, SalesOverview } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

export function OrdersCard({
  sales,
  timeseries,
  currency,
}: {
  sales: SalesOverview | null;
  timeseries: OverviewTimeseries | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  const orders = sales?.orderCount ?? 0;
  const units = sales?.unitsSold ?? 0;
  const months = timeseries?.months ?? [];
  const rate = returnRate(sumMonths(months, "orders"), sumMonths(months, "returned_cancelled"));
  // Kept orders and returned/cancelled stack to the month's total order count.
  const data = months.map((m) => ({
    label: monthLabel(m.month),
    kept: m.orders - m.returned_cancelled,
    returned: m.returned_cancelled,
  }));

  const meta = [
    `${units.toLocaleString()} unit${units !== 1 ? "s" : ""} sold`,
    rate !== null ? `${rate.toFixed(1)}% returned/cancelled` : null,
  ].filter(Boolean).join(" · ");

  return (
    <ChartCard
      title="Orders"
      headline={orders.toLocaleString()}
      change={pctChange(orders, timeseries?.previous?.orders)}
      meta={meta}
      empty={!months.some((m) => m.orders > 0)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} vertical={false} />
          <XAxis dataKey="label" {...kit.axis} />
          <YAxis {...kit.axis} allowDecimals={false} width={40} />
          <Tooltip {...kit.tooltip} cursor={{ fill: kit.colors.grid, opacity: 0.4 }} />
          <Legend {...kit.legend} />
          <Bar dataKey="kept" name="Orders" stackId="orders" fill={kit.colors.neutral} maxBarSize={40} />
          <Bar dataKey="returned" name="Returned/cancelled" stackId="orders" fill={kit.colors.negative} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
