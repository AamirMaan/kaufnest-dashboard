"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import { monthLabel, pctChange, sumMonths } from "../_lib/overviewCharts";
import type { OverviewTimeseries, PurchasesOverview } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

export function PurchasesCard({
  purchases,
  timeseries,
  currency,
}: {
  purchases: PurchasesOverview | null;
  timeseries: OverviewTimeseries | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  const total = purchases?.total ?? 0;
  const months = timeseries?.months ?? [];
  const units = sumMonths(months, "units");
  const vendor = timeseries?.top_vendor;
  const data = months.map((m) => ({ label: monthLabel(m.month), value: m.purchases }));

  const meta = [
    units > 0 ? `${units.toLocaleString()} unit${units !== 1 ? "s" : ""} bought` : null,
    vendor ? `Top vendor: ${vendor.name} (${kit.money(vendor.amount)})` : null,
  ].filter(Boolean).join(" · ");

  return (
    <ChartCard
      title="Purchases"
      headline={kit.money(total)}
      change={pctChange(total, timeseries?.previous?.purchases)}
      goodWhen="down"
      meta={meta || undefined}
      empty={!data.some((d) => d.value !== 0)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} vertical={false} />
          <XAxis dataKey="label" {...kit.axis} />
          <YAxis {...kit.axis} tickFormatter={kit.compact} width={56} />
          <Tooltip
            {...kit.tooltip}
            cursor={{ fill: kit.colors.grid, opacity: 0.4 }}
            formatter={(value) => [kit.money(Number(value ?? 0)), "Purchases"]}
          />
          <Bar dataKey="value" name="Purchases" fill={kit.colors.pending} radius={[3, 3, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
