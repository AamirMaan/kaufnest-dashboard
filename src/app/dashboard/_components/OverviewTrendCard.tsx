"use client";

import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import { trendSeries, type TrendMetric } from "../_lib/kpiTiles";
import type { OverviewTimeseries } from "../_lib/overviewTypes";
import { useChartKit } from "./useChartKit";

const METRICS: { value: TrendMetric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "orders", label: "Orders" },
  { value: "profit", label: "Profit" },
];

/** Home's single chart: last 12 months, switchable metric (Apex "Performance" card). */
export function OverviewTrendCard({
  trailing,
  currency,
  loading,
}: {
  trailing: OverviewTimeseries | null;
  currency: Currency;
  loading: boolean;
}) {
  const kit = useChartKit(currency);
  const [metric, setMetric] = useState<TrendMetric>("revenue");
  const gradientId = `trend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const data = trendSeries(trailing?.months ?? [], metric);
  const hasData = data.some((p) => p.value !== 0);
  const color = metric === "orders" ? kit.colors.neutral : kit.colors.positive;
  const fmt = metric === "orders" ? (v: number) => v.toLocaleString() : kit.compact;
  const tooltipFmt = metric === "orders" ? (v: number) => v.toLocaleString() : kit.money;

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 flex flex-col xl:col-span-2"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--color-text-strong)">Performance</h2>
          <p className="text-sm text-(--color-text-muted)">Last 12 months</p>
        </div>
        <div role="group" aria-label="Chart metric"
          className="inline-flex rounded-[var(--radius-btn)] bg-(--color-surface-subtle) border border-(--color-border-subtle) p-1">
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={metric === m.value}
              onClick={() => setMetric(m.value)}
              className={`px-3 py-1.5 text-sm rounded-[var(--radius-btn)] transition-colors cursor-pointer ${
                metric === m.value
                  ? "bg-(--color-surface) text-(--color-text-strong) font-medium border border-(--color-border)"
                  : "text-(--color-text-muted) hover:text-(--color-text-strong) border border-transparent"
              }`}
              style={metric === m.value ? { boxShadow: "var(--shadow-card)" } : undefined}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 h-[300px]">
        {loading ? (
          <div className="h-full rounded-[var(--radius-btn)] bg-(--color-border-subtle) animate-pulse" />
        ) : hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke={kit.colors.grid} vertical={false} />
              <XAxis dataKey="label" {...kit.axis} />
              <YAxis {...kit.axis} tickFormatter={fmt} width={56} />
              <Tooltip {...kit.tooltip} formatter={(v) => [tooltipFmt(Number(v ?? 0)), METRICS.find((m) => m.value === metric)?.label]} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5}
                fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: color }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-(--color-text-faint)">
            No data in this period
          </div>
        )}
      </div>
    </section>
  );
}
