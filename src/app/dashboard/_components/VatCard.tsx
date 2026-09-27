"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import { monthLabel } from "../_lib/overviewCharts";
import type { OverviewTimeseries } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

export function VatCard({
  vatCollected,
  vatPaid,
  timeseries,
  currency,
}: {
  /** Output VAT on effective sales. */
  vatCollected: number;
  /** Input VAT on purchases + expenses (may be negative for credit notes). */
  vatPaid: number;
  timeseries: OverviewTimeseries | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  const position = vatCollected - vatPaid;
  const data = (timeseries?.months ?? []).map((m) => ({
    label: monthLabel(m.month),
    collected: m.vat_collected,
    paid: m.vat_paid,
  }));
  // `!== 0`, not `> 0`: a refunds-only period has negative input VAT.
  const hasData = vatCollected !== 0 || vatPaid !== 0;

  return (
    <ChartCard
      title={position >= 0 ? "VAT Position · Due to Government" : "VAT Position · Government Refund"}
      headline={kit.money(Math.abs(position))}
      meta={`Collected ${kit.money(vatCollected)} · Paid ${kit.money(vatPaid)}`}
      empty={!hasData}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} vertical={false} />
          <XAxis dataKey="label" {...kit.axis} />
          <YAxis {...kit.axis} tickFormatter={kit.compact} width={56} />
          <Tooltip
            {...kit.tooltip}
            cursor={{ fill: kit.colors.grid, opacity: 0.4 }}
            formatter={(value, name) => [kit.money(Number(value ?? 0)), String(name ?? "")]}
          />
          <Legend {...kit.legend} />
          <Bar dataKey="collected" name="Collected (output)" fill={kit.colors.positive} radius={[3, 3, 0, 0]} maxBarSize={24} />
          <Bar dataKey="paid" name="Paid (input)" fill={kit.colors.negative} radius={[3, 3, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
