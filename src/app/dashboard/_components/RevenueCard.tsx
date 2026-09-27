"use client";

import type { Currency } from "@/types";
import { pctChange, stackedSeries } from "../_lib/overviewCharts";
import type { OverviewTimeseries, SalesOverview } from "../_lib/overviewTypes";
import { ChartCard } from "./ChartCard";
import { StackedBars } from "./StackedBars";
import { useChartKit } from "./useChartKit";

const PLATFORM_NAMES: Record<string, string> = { ebay: "eBay", amazon: "Amazon" };

function platformName(key: string): string {
  return PLATFORM_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function RevenueCard({
  sales,
  timeseries,
  currency,
}: {
  sales: SalesOverview | null;
  timeseries: OverviewTimeseries | null;
  currency: Currency;
}) {
  const kit = useChartKit(currency);
  const revenue = sales?.revenue ?? 0;
  const orders = sales?.effectiveOrderCount ?? 0;
  const series = stackedSeries(timeseries?.months ?? [], "revenue_by_platform");

  return (
    <ChartCard
      title="Revenue"
      headline={kit.money(revenue)}
      change={pctChange(revenue, timeseries?.previous?.revenue)}
      meta={
        orders > 0
          ? `Avg. order ${kit.money(revenue / orders)} · ${orders.toLocaleString()} order${orders !== 1 ? "s" : ""} (excl. returns)`
          : undefined
      }
      empty={series.keys.length === 0}
    >
      <StackedBars series={series} kit={kit} labelFor={platformName} />
    </ChartCard>
  );
}
