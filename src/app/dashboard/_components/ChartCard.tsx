"use client";

import type { ReactNode } from "react";
import { changeTone, formatPct } from "../_lib/overviewCharts";

interface ChartCardProps {
  title: string;
  headline: string;
  /** Percent change vs the previous period; hidden when null/undefined. */
  change?: number | null;
  /** Direction that is good news for this metric (costs: "down"). */
  goodWhen?: "up" | "down";
  /** Small text under the headline — period facts such as AOV or margin. */
  meta?: ReactNode;
  /** Optional control in the header (e.g. Record Transfer). */
  action?: ReactNode;
  /** Replaces the chart with "No data in this period". */
  empty?: boolean;
  children: ReactNode;
}

const TONE_CLASS = {
  good: "text-(--color-success)",
  bad: "text-(--color-danger)",
  neutral: "text-(--color-text-muted)",
} as const;

/**
 * Shell shared by every Overview card: title, headline figure, change badge,
 * meta line and a fixed-height chart slot. Display-only.
 */
export function ChartCard({
  title,
  headline,
  change,
  goodWhen = "up",
  meta,
  action,
  empty = false,
  children,
}: ChartCardProps) {
  const tone = changeTone(change ?? null, goodWhen);

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 flex flex-col"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-(--color-text-strong)">{title}</h2>
        {action}
      </div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <p className="text-2xl font-bold tabular-nums text-(--color-text-strong)">{headline}</p>
        {change !== null && change !== undefined && (
          <span
            className={`text-xs font-medium tabular-nums ${TONE_CLASS[tone]}`}
            title="Change vs the previous period of the same length"
          >
            {change > 0 ? "▲" : change < 0 ? "▼" : ""} {formatPct(change)}
          </span>
        )}
      </div>
      {meta && <div className="mt-1 text-xs text-(--color-text-muted)">{meta}</div>}
      <div className="mt-4 h-[220px]">
        {empty ? (
          <div className="h-full flex items-center justify-center text-sm text-(--color-text-faint)">
            No data in this period
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
