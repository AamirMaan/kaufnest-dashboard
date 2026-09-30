"use client";

import type { Currency } from "@/types";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils/date";
import { seriesColor } from "../_lib/chartPalette";
import type { PlatformStat } from "../_lib/platformStats";
import { platformLabel } from "../_lib/recentOrderDisplay";
import { useChartKit } from "./useChartKit";

/**
 * Home's per-platform numbers: revenue + share for every platform, and for
 * eBay/Amazon the balance breakdown (fees, expenses, payouts, what's still
 * in the platform account). The chart version lives on Analytics
 * (PlatformBalanceCard).
 */
export function PlatformStatsCard({
  stat,
  index,
  currency,
  asOf,
  onRecordTransfer,
}: {
  stat: PlatformStat;
  /** Position in the list — picks a fallback dot colour for unknown platforms. */
  index: number;
  currency: Currency;
  /** ISO date the running "still in account" balance runs up to. */
  asOf: string;
  /** Admin-only, eBay/Amazon only; the button is hidden when omitted. */
  onRecordTransfer?: () => void;
}) {
  const kit = useChartKit(currency);
  const b = stat.balance;
  const name = platformLabel(stat.platform);

  const rows: { label: string; value: string; tone?: string }[] = b
    ? [
        { label: "Orders", value: b.count.toLocaleString() },
        { label: "Avg. order", value: b.count > 0 ? kit.money(b.sales / b.count) : "—" },
        { label: "Ad fees", value: kit.money(-b.adFees), tone: "text-(--color-danger)" },
        { label: "Shipping", value: kit.money(-b.shippingFees), tone: "text-(--color-danger)" },
        { label: "Platform fees", value: kit.money(-b.platformFees), tone: "text-(--color-danger)" },
        // Expense records whose vendor/title names the platform — not per-order fees.
        { label: `Expenses tagged ${name}`, value: kit.money(-b.expenses), tone: "text-(--color-danger)" },
        { label: "Balance earned (period)", value: kit.money(b.balance) },
        { label: "Transferred (period)", value: kit.money(b.transferred) },
      ]
    : [];

  return (
    <section
      className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 flex flex-col"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColor(stat.platform, index) }} />
          <h2 className="text-base font-semibold text-(--color-text-strong) truncate">{name}</h2>
        </div>
        <span className="text-xs font-medium tabular-nums text-(--color-text-muted)">
          {stat.sharePct.toFixed(0)}% of revenue
        </span>
      </div>

      <p className="mt-3 text-sm text-(--color-text-muted)">Revenue</p>
      <p className="text-2xl font-bold tabular-nums text-(--color-text-strong)">{kit.money(stat.revenue)}</p>

      {b && (
        <>
          <dl className="mt-4 space-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3">
                <dt className="text-(--color-text-muted)">{r.label}</dt>
                <dd className={`font-medium tabular-nums ${r.tone ?? "text-(--color-text-strong)"}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 pt-4 border-t border-(--color-border) flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-(--color-text-muted)">Still in {name} account</p>
              {/* Running balance to date; falls back to this period's figure if 054's RPC failed. */}
              <p className="text-[11px] text-(--color-text-faint)">
                {b.pendingIsRunning ? `as of ${formatDate(asOf)}` : "this period only"}
              </p>
              <p className={`text-lg font-bold tabular-nums ${b.pending >= 0 ? "text-(--color-warning)" : "text-(--color-danger)"}`}>
                {kit.money(b.pending)}
              </p>
            </div>
            {onRecordTransfer && (
              <Button variant="secondary" size="sm" onClick={onRecordTransfer}>
                Record Transfer
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
