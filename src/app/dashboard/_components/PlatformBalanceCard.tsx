"use client";

import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BarShapeProps } from "recharts";
import type { Currency } from "@/types";
import { balanceBars, type BalanceTone } from "../_lib/overviewCharts";
import type { PlatformBalance } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit, type ChartKit } from "./useChartKit";

const TITLES = { ebay: "eBay Balance", amazon: "Amazon Balance" } as const;
const ACCOUNT = { ebay: "eBay", amazon: "Amazon" } as const;

function toneColor(tone: BalanceTone, kit: ChartKit): string {
  if (tone === "positive") return kit.colors.positive;
  if (tone === "negative") return kit.colors.negative;
  if (tone === "pending") return kit.colors.pending;
  return kit.colors.neutral;
}

export function PlatformBalanceCard({
  platform,
  balance,
  currency,
  onRecordTransfer,
}: {
  platform: "ebay" | "amazon";
  balance: PlatformBalance;
  currency: Currency;
  /** Admin-only; the button is hidden when omitted. */
  onRecordTransfer?: () => void;
}) {
  const kit = useChartKit(currency);
  const bars = balanceBars(balance);
  const colors = bars.map((b) => toneColor(b.tone, kit));

  return (
    <ChartCard
      title={TITLES[platform]}
      headline={kit.money(balance.balance)}
      meta={
        <>
          {balance.count} order{balance.count !== 1 ? "s" : ""} · Balance earned = sales − fees − expenses ·{" "}
          <span className={balance.pending >= 0 ? "text-(--color-warning)" : "text-(--color-danger)"}>
            {kit.money(balance.pending)} still in {ACCOUNT[platform]} account
          </span>
        </>
      }
      action={
        onRecordTransfer && (
          <button
            onClick={onRecordTransfer}
            className="text-xs font-medium px-2.5 py-1 rounded-(--radius-btn) bg-(--color-primary-muted) text-(--color-primary-text) hover:bg-(--color-primary) hover:text-white transition-colors cursor-pointer"
          >
            Record Transfer
          </button>
        )
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} horizontal={false} />
          <XAxis type="number" {...kit.axis} tickFormatter={kit.compact} />
          <YAxis type="category" dataKey="name" {...kit.axis} width={84} />
          <Tooltip
            {...kit.tooltip}
            cursor={{ fill: kit.colors.grid, opacity: 0.4 }}
            formatter={(value) => [kit.money(Number(value ?? 0)), "Amount"]}
          />
          <Bar
            dataKey="value"
            maxBarSize={22}
            shape={(props: BarShapeProps) => <Rectangle {...props} fill={colors[props.index]} radius={[0, 3, 3, 0]} />}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
