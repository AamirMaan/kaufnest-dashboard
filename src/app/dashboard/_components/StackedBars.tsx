"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { seriesColor } from "../_lib/chartPalette";
import type { StackedSeries } from "../_lib/overviewCharts";
import type { ChartKit } from "./useChartKit";

interface StackedBarsProps {
  series: StackedSeries;
  kit: ChartKit;
  /** Display name for a series key (platform or category). */
  labelFor: (key: string) => string;
}

/** Monthly bars stacked by platform/category — Revenue and Expenses cards. */
export function StackedBars({ series, kit, labelFor }: StackedBarsProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={series.rows} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} vertical={false} />
        <XAxis dataKey="label" {...kit.axis} />
        <YAxis {...kit.axis} tickFormatter={kit.compact} width={56} />
        <Tooltip
          {...kit.tooltip}
          cursor={{ fill: kit.colors.grid, opacity: 0.4 }}
          formatter={(value, name) => [kit.money(Number(value ?? 0)), String(name ?? "")]}
        />
        <Legend {...kit.legend} />
        {series.keys.map((key, i) => (
          <Bar
            key={key}
            dataKey={(row: StackedSeries["rows"][number]) => row.values[key] ?? 0}
            name={labelFor(key)}
            stackId="stack"
            fill={seriesColor(key, i)}
            maxBarSize={40}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
