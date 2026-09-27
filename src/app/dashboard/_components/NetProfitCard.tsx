"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import { bestWorstMonth, margin, netProfitSeries } from "../_lib/overviewCharts";
import type { OverviewTimeseries } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

export function NetProfitCard({
  netProfit,
  revenue,
  timeseries,
  currency,
}: {
  /** Revenue − (expenses + sale fees) − purchases for the whole period. */
  netProfit: number;
  revenue: number;
  timeseries: OverviewTimeseries | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  const months = timeseries?.months ?? [];
  const series = netProfitSeries(months);
  const extremes = bestWorstMonth(series);
  const pct = margin(netProfit, revenue);
  const lineColor = netProfit >= 0 ? kit.colors.positive : kit.colors.negative;

  const meta = [
    pct !== null ? `${pct.toFixed(1)}% margin` : netProfit >= 0 ? "Profitable in this period" : "Loss in this period",
    extremes ? `Best ${extremes.best.label} · Worst ${extremes.worst.label}` : null,
  ].filter(Boolean).join(" · ");

  const hasActivity = months.some(
    (m) => m.orders !== 0 || m.expenses !== 0 || m.purchases !== 0
  );

  return (
    <ChartCard title="Net Profit" headline={kit.money(netProfit)} meta={meta} empty={!hasActivity}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} vertical={false} />
          <XAxis dataKey="label" {...kit.axis} />
          <YAxis {...kit.axis} tickFormatter={kit.compact} width={56} />
          <ReferenceLine y={0} stroke={kit.colors.tick} strokeDasharray="4 4" />
          <Tooltip {...kit.tooltip} formatter={(value) => [kit.money(Number(value ?? 0)), "Net profit"]} />
          <Line
            type="monotone"
            dataKey="value"
            name="Net profit"
            stroke={lineColor}
            strokeWidth={2}
            dot={series.length <= 12 ? { r: 3, strokeWidth: 0, fill: lineColor } : false}
            activeDot={{ r: 4, strokeWidth: 0, fill: lineColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
