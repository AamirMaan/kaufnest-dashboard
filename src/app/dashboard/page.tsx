"use client";

import { DollarSign, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { type Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { buildKpis } from "./_lib/kpiTiles";
import { useDateRangePicker, describeRange } from "./_components/useDateRangePicker";
import { DateRangePicker } from "./_components/DateRangePicker";
import { useOverviewData } from "./_components/useOverviewData";
import { useChartKit } from "./_components/useChartKit";
import { KpiTile } from "./_components/KpiTile";
import { OverviewTrendCard } from "./_components/OverviewTrendCard";
import { PlatformDonutCard } from "./_components/PlatformDonutCard";
import { RecentOrdersCard } from "./_components/RecentOrdersCard";

export default function DashboardPage() {
  const profileCurrency: Currency =
    useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const picker = useDateRangePicker();
  const data = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    profileCurrency
  );
  const kit = useChartKit(profileCurrency);
  const kpis = buildKpis(data);
  const firstLoad = data.isLoading && data.sales === null;
  const rangeLabel = describeRange(picker.range);

  return (
    <div>
      <PageHeader title="Overview" description={`Summary for ${rangeLabel}`}
        action={<DateRangePicker picker={picker} />} />

      <div className={`space-y-4 ${data.isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <OverviewTrendCard trailing={data.trailing} currency={profileCurrency} />
          <PlatformDonutCard sales={data.sales} rangeLabel={rangeLabel} currency={profileCurrency} />
        </div>
      </div>

      <div className="mt-4">
        <RecentOrdersCard />
      </div>

      <div className="mt-4 bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <h2 className="text-base font-semibold text-(--color-text-strong) mb-1">Quick Start</h2>
        <p className="text-sm text-(--color-text-muted)">
          Use the sidebar to navigate to Orders, Expenses, and Purchases, or open Analytics for
          detailed charts. Figures above reflect the selected date range and use {profileCurrency} as
          the base currency. Change badges compare with the period of the same length just before
          it; sparklines and the Overview chart always show the last 12 months.
        </p>
      </div>
    </div>
  );
}
