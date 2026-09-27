"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/types";
import type { SalesOverview } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

function truncate(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function TopProductsCard({
  sales,
  currency,
}: {
  sales: SalesOverview | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  // get_sales_overview already groups, sorts and limits to the top 5.
  const products = sales?.topProducts ?? [];
  const top = products[0];
  const data = products.map((p) => ({ ...p, short: truncate(p.name) }));

  return (
    <ChartCard
      title="Top Products"
      headline={top ? kit.money(top.revenue) : kit.money(0)}
      meta={top ? `Best seller: ${top.name} · ${top.units} unit${top.units !== 1 ? "s" : ""}` : undefined}
      empty={products.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={kit.colors.grid} horizontal={false} />
          <XAxis type="number" {...kit.axis} tickFormatter={kit.compact} />
          <YAxis type="category" dataKey="short" {...kit.axis} width={140} />
          <Tooltip
            {...kit.tooltip}
            cursor={{ fill: kit.colors.grid, opacity: 0.4 }}
            labelFormatter={(_, payload) => String(payload?.[0]?.payload?.name ?? "")}
            formatter={(value, _name, item) => [
              `${kit.money(Number(value ?? 0))} · ${item?.payload?.units ?? 0} units`,
              "Revenue",
            ]}
          />
          <Bar dataKey="revenue" name="Revenue" fill={kit.colors.positive} radius={[0, 3, 3, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
