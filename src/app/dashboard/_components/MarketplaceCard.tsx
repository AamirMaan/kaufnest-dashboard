"use client";

import type { Currency } from "@/types";
import type { MarketplaceRow } from "../_lib/overviewTypes";
import { marketplaceShares } from "../_lib/marketplaceRows";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

/** Revenue, VAT and net VAT base per marketplace for the picked range (052). Ranked table, TopProductsCard style. */
export function MarketplaceCard({ rows, currency }: { rows: MarketplaceRow[] | null; currency: Currency }) {
  const kit = useChartKit(currency);
  const { rows: shares } = marketplaceShares(rows ?? []);
  const top = shares[0];

  return (
    <ChartCard
      title="Revenue by Marketplace"
      headline={top ? kit.money(top.revenue) : kit.money(0)}
      meta={top ? `Largest: ${top.label} · ${top.sharePct}%` : undefined}
      empty={shares.length === 0}
      bodyClassName="mt-4"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-(--color-text-muted) border-b border-(--color-border-subtle)">
            <th className="py-2 pr-2 font-medium">Marketplace</th>
            <th className="py-2 pr-2 font-medium text-right">Orders</th>
            <th className="py-2 pr-2 font-medium text-right">Revenue</th>
            <th className="py-2 pr-2 font-medium text-right">VAT</th>
            <th className="py-2 font-medium text-right">VAT base</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((m) => (
            <tr key={m.label} className="border-b border-(--color-border-subtle) last:border-0">
              <td className="py-2.5 pr-2 min-w-0">
                <p className="truncate max-w-[12rem] text-(--color-text-strong)" title={m.label}>{m.label}</p>
                <div className="mt-1 h-1 w-full max-w-[12rem] rounded-full bg-(--color-border-subtle)">
                  <div className="h-1 rounded-full bg-(--color-primary)" style={{ width: `${m.sharePct}%` }} />
                </div>
              </td>
              <td className="py-2.5 pr-2 text-right tabular-nums text-(--color-text-base)">{m.order_count.toLocaleString()}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums font-medium text-(--color-text-strong)">{kit.money(m.revenue)}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums text-(--color-text-base)">{kit.money(m.vat)}</td>
              <td className="py-2.5 text-right tabular-nums text-(--color-text-base)">{kit.money(m.vat_base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}
