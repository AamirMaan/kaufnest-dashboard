"use client";

import { useId, type ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { changeTone, formatPct } from "../_lib/overviewCharts";

export interface KpiTileProps {
  label: string;
  value: string;
  delta: number | null;
  /** Direction that is good news; omit for a neutral-toned delta. */
  goodWhen?: "up" | "down";
  icon: ReactNode;
  spark: number[];
  /** Sparkline colour — hex from useChartKit().colors (SVG attrs can't read CSS vars). */
  color: string;
  loading?: boolean;
}

const TONE_CLASS = {
  good: "text-(--color-success)",
  bad: "text-(--color-danger)",
  neutral: "text-(--color-text-muted)",
} as const;

/** Apex-style stat tile: label + value + icon chip, delta line, edge-to-edge sparkline. */
export function KpiTile({ label, value, delta, goodWhen, icon, spark, color, loading = false }: KpiTileProps) {
  // useId() contains characters that break url(#…) references.
  const gradientId = `kpi-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tone = goodWhen ? changeTone(delta, goodWhen) : "neutral";
  const data = spark.map((v, i) => ({ i, v }));

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) overflow-hidden flex flex-col"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="p-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-(--color-text-muted)">{label}</p>
            {loading ? (
              <div className="mt-2 h-7 w-28 rounded-[var(--radius-btn)] bg-(--color-border-subtle) animate-pulse" />
            ) : (
              <p className="mt-1 text-2xl font-bold tabular-nums text-(--color-text-strong) truncate">{value}</p>
            )}
          </div>
          <span
            aria-hidden
            className="shrink-0 flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] bg-(--color-primary-muted) text-(--color-primary-text)"
          >
            {icon}
          </span>
        </div>
        <div className="mt-2 h-4 text-xs font-medium">
          {!loading && delta !== null && (
            <span className={`inline-flex items-center gap-1 tabular-nums ${TONE_CLASS[tone]}`}>
              {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {formatPct(delta)}
              <span className="ml-1 font-normal text-(--color-text-faint)">vs previous period</span>
            </span>
          )}
        </div>
      </div>
      <div className="h-14 mt-auto" aria-hidden>
        {!loading && data.length >= 2 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
