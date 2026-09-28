"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Currency } from "@/types";
import { seriesColor } from "../_lib/chartPalette";
import { platformShares } from "../_lib/platformShare";
import type { SalesOverview } from "../_lib/overviewTypes";
import { platformLabel } from "../_lib/recentOrderDisplay";
import { useChartKit } from "./useChartKit";

export function PlatformDonutCard({
  sales, rangeLabel, currency,
}: { sales: SalesOverview | null; rangeLabel: string; currency: Currency }) {
  const kit = useChartKit(currency);
  const { total, shares } = platformShares(sales?.revenueByPlatform ?? []);

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 flex flex-col"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="text-base font-semibold text-(--color-text-strong)">Revenue by Platform</h2>
      <p className="text-sm text-(--color-text-muted)">{rangeLabel}</p>
      {shares.length === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-(--color-text-faint)">
          No sales in this period
        </div>
      ) : (
        <>
          <div className="relative mt-4 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shares} dataKey="value" nameKey="platform" innerRadius="70%" outerRadius="100%"
                  paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {shares.map((s, i) => <Cell key={s.platform} fill={seriesColor(s.platform, i)} />)}
                </Pie>
                <Tooltip {...kit.tooltip}
                  formatter={(v, name) => [kit.money(Number(v ?? 0)), platformLabel(String(name))]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-(--color-text-strong)">{kit.compact(total)}</span>
              <span className="text-xs text-(--color-text-muted)">Revenue</span>
            </div>
          </div>
          <ul className="mt-5 space-y-2.5">
            {shares.map((s, i) => (
              <li key={s.platform} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: seriesColor(s.platform, i) }} />
                <span className="text-(--color-text-base)">{platformLabel(s.platform)}</span>
                <span className="ml-auto font-semibold tabular-nums text-(--color-text-strong)">{s.pct.toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
