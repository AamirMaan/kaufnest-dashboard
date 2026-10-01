"use client";

import { useMemo, useState } from "react";
import { DollarSign, Landmark, Receipt, ShoppingBag, ShoppingCart, TrendingUp } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { type Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { buildKpis } from "./_lib/kpiTiles";
import { buildPlatformStats } from "./_lib/platformStats";
import { useDateRangePicker, describeRange } from "./_components/useDateRangePicker";
import { DateRangePicker } from "./_components/DateRangePicker";
import { useOverviewData } from "./_components/useOverviewData";
import { useChartKit } from "./_components/useChartKit";
import { KpiTile } from "./_components/KpiTile";
import { PlatformStatsCard } from "./_components/PlatformStatsCard";
import { RecentOrdersCard } from "./_components/RecentOrdersCard";
import { RecordTransferModal } from "./_components/RecordTransferModal";

/** Home = the numbers (KPI tiles, per-platform stats, recent orders). Charts live on Analytics. */
export default function DashboardPage() {
  const profileCurrency: Currency =
    useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const { can } = useAccess();
  const canRecordTransfer = can("payouts", 2);
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);

  const picker = useDateRangePicker();
  const data = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    profileCurrency
  );
  const kit = useChartKit(profileCurrency);
  const kpis = buildKpis(data);
  const firstLoad = data.isLoading && data.sales === null;
  const rangeLabel = describeRange(picker.range);

  const platformStats = useMemo(
    () => buildPlatformStats(data.sales, data.expenses, data.payouts, data.running),
    [data.sales, data.expenses, data.payouts, data.running]
  );
  const pendingFor = (p: "ebay" | "amazon") =>
    platformStats.find((s) => s.platform === p)?.balance?.pending ?? 0;

  return (
    <div>
      <PageHeader title="Overview" description={`Summary for ${rangeLabel}`}
        action={<DateRangePicker picker={picker} />} />

      <div className={`space-y-6 ${data.isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <KpiTile label="Revenue" value={kit.money(kpis.revenue.value)} delta={kpis.revenue.delta}
            goodWhen="up" icon={<DollarSign size={18} />} spark={kpis.revenue.spark}
            color={kit.colors.positive} loading={firstLoad} />
          <KpiTile label="Net Profit" value={kit.money(kpis.netProfit.value)} delta={kpis.netProfit.delta}
            goodWhen="up" icon={<TrendingUp size={18} />} spark={kpis.netProfit.spark}
            color={kpis.netProfit.value >= 0 ? kit.colors.positive : kit.colors.negative} loading={firstLoad} />
          <KpiTile label="Orders" value={kpis.orders.value.toLocaleString()} delta={kpis.orders.delta}
            goodWhen="up" icon={<ShoppingCart size={18} />} spark={kpis.orders.spark}
            color={kit.colors.neutral} loading={firstLoad} />
          <KpiTile label="Expenses" value={kit.money(kpis.expenses.value)} delta={kpis.expenses.delta}
            goodWhen="down" icon={<Receipt size={18} />} spark={kpis.expenses.spark}
            color={kit.colors.negative} loading={firstLoad} />
          <KpiTile label="Purchases" value={kit.money(kpis.purchases.value)} delta={kpis.purchases.delta}
            goodWhen="down" icon={<ShoppingBag size={18} />} spark={kpis.purchases.spark}
            color={kit.colors.neutral} loading={firstLoad} />
          <KpiTile label={kpis.vatPosition.value >= 0 ? "VAT payable" : "VAT refundable"}
            value={kit.money(Math.abs(kpis.vatPosition.value))} delta={null}
            icon={<Landmark size={18} />} spark={kpis.vatPosition.spark}
            color={kit.colors.pending} loading={firstLoad} />
        </div>

        <section>
          <h2 className="text-base font-semibold text-(--color-text-strong) mb-3">By Platform</h2>
          {platformStats.length === 0 ? (
            <div
              className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 text-sm text-(--color-text-faint)"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              {firstLoad ? "Loading…" : "No sales in this period"}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {platformStats.map((stat, i) => {
                const p = stat.platform;
                const target = p === "ebay" || p === "amazon" ? p : null;
                return (
                  <PlatformStatsCard key={p} stat={stat} index={i} currency={profileCurrency}
                    asOf={data.runningAsOf}
                    onRecordTransfer={canRecordTransfer && target && stat.balance
                      ? () => setTransferModal(target) : undefined} />
                );
              })}
            </div>
          )}
        </section>
      </div>

      {can("orders", 1) && (
        <div className="mt-6">
          <RecentOrdersCard />
        </div>
      )}

      <div className="mt-4 bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <h2 className="text-base font-semibold text-(--color-text-strong) mb-1">Quick Start</h2>
        <p className="text-sm text-(--color-text-muted)">
          Use the sidebar to navigate to Orders, Expenses, and Purchases, or open Analytics for
          charts and trends. Figures above reflect the selected date range and use {profileCurrency} as
          the base currency. Change badges compare with the period of the same length just before
          it; sparklines always show the last 12 months.
        </p>
      </div>

      {transferModal !== null && (
        <RecordTransferModal
          platform={transferModal}
          currency={profileCurrency}
          pendingBalance={pendingFor(transferModal)}
          onClose={() => setTransferModal(null)}
          onSaved={() => setTransferModal(null)}
        />
      )}
    </div>
  );
}
