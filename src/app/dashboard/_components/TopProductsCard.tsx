"use client";

import type { Currency } from "@/types";
import type { SalesOverview } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

export function TopProductsCard({ sales, currency }: { sales: SalesOverview | null; currency: Currency }) {
  const kit = useChartKit(currency);
  // get_sales_overview already groups, sorts and limits to the top 5.
  const products = sales?.topProducts ?? [];
  const top = products[0];
  const periodRevenue = sales?.revenue ?? 0;

  return (
    <ChartCard
      title="Top Products"
      headline={top ? kit.money(top.revenue) : kit.money(0)}
      meta={top ? `Best seller: ${top.name} · ${top.units} unit${top.units !== 1 ? "s" : ""}` : undefined}
      empty={products.length === 0}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-(--color-text-muted) border-b border-(--color-border-subtle)">
            <th className="py-2 pr-2 font-medium w-8">#</th>
            <th className="py-2 pr-2 font-medium">Product</th>
            <th className="py-2 pr-2 font-medium text-right">Units</th>
            <th className="py-2 font-medium text-right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const share = periodRevenue > 0 ? Math.min(100, (p.revenue / periodRevenue) * 100) : 0;
            return (
              <tr key={p.name} className="border-b border-(--color-border-subtle) last:border-0">
                <td className="py-2.5 pr-2 text-(--color-text-faint) tabular-nums">{i + 1}</td>
                <td className="py-2.5 pr-2 min-w-0">
                  <p className="truncate max-w-[16rem] text-(--color-text-strong)" title={p.name}>{p.name}</p>
                  <div className="mt-1 h-1 w-full max-w-[16rem] rounded-full bg-(--color-border-subtle)">
                    <div className="h-1 rounded-full bg-(--color-primary)" style={{ width: `${share}%` }} />
                  </div>
                </td>
                <td className="py-2.5 pr-2 text-right tabular-nums text-(--color-text-base)">{p.units.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums font-medium text-(--color-text-strong)">{kit.money(p.revenue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ChartCard>
  );
}
