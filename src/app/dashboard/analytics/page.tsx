"use client";

import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import type { Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { calculateNetProfit } from "@/lib/utils/currency";
import { computePlatformBalance } from "../_lib/platformBalance";
import { useDateRangePicker, describeRange } from "../_components/useDateRangePicker";
import { DateRangePicker } from "../_components/DateRangePicker";
import { useOverviewData } from "../_components/useOverviewData";
import { OverviewTrendCard } from "../_components/OverviewTrendCard";
import { PlatformDonutCard } from "../_components/PlatformDonutCard";
import { RevenueCard } from "../_components/RevenueCard";
import { NetProfitCard } from "../_components/NetProfitCard";
import { ExpensesCard } from "../_components/ExpensesCard";
import { PurchasesCard } from "../_components/PurchasesCard";
import { OrdersCard } from "../_components/OrdersCard";
import { VatCard } from "../_components/VatCard";
import { PlatformBalanceCard } from "../_components/PlatformBalanceCard";
import { TopProductsCard } from "../_components/TopProductsCard";

/** Analytics = every chart. The headline numbers (KPI tiles, per-platform stats) live on Home. */
export default function AnalyticsPage() {
  const currency: Currency = useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";

  const picker = useDateRangePicker();
  const data = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    currency
  );
  const rangeLabel = describeRange(picker.range);

  const revenue = data.sales?.revenue ?? 0;
  const netProfit = calculateNetProfit(
    revenue,
    (data.expenses?.total ?? 0) + (data.sales?.fees ?? 0),
    data.purchases?.total ?? 0
  );
  const vatCollected = data.sales?.vatCollected ?? 0;
  const vatPaid = (data.purchases?.vatPaid ?? 0) + (data.expenses?.vatPaid ?? 0);

  const ebayBalance = useMemo(
    () => computePlatformBalance("ebay", data.sales, data.expenses, data.payouts),
    [data.sales, data.expenses, data.payouts]
  );
  const amazonBalance = useMemo(
    () => computePlatformBalance("amazon", data.sales, data.expenses, data.payouts),
    [data.sales, data.expenses, data.payouts]
  );

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={`Charts for ${rangeLabel}`}
        action={<DateRangePicker picker={picker} />}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <OverviewTrendCard trailing={data.trailing} currency={currency} loading={data.trailingLoading} />
        <PlatformDonutCard sales={data.sales} rangeLabel={rangeLabel} currency={currency} />
      </div>

      <div className={data.isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RevenueCard sales={data.sales} timeseries={data.timeseries} currency={currency} />
          <NetProfitCard netProfit={netProfit} revenue={revenue}
            timeseries={data.timeseries} currency={currency} />
          <ExpensesCard expenses={data.expenses} timeseries={data.timeseries} currency={currency} />
          <PurchasesCard purchases={data.purchases} timeseries={data.timeseries} currency={currency} />
          <OrdersCard sales={data.sales} timeseries={data.timeseries} currency={currency} />
          <VatCard vatCollected={vatCollected} vatPaid={vatPaid} timeseries={data.timeseries} currency={currency} />
          {/* Balance charts are hidden when the platform had no sales in the period.
              Record Transfer lives on Home's per-platform stat cards. */}
          {ebayBalance !== null && <PlatformBalanceCard platform="ebay" balance={ebayBalance} currency={currency} />}
          {amazonBalance !== null && <PlatformBalanceCard platform="amazon" balance={amazonBalance} currency={currency} />}
          <TopProductsCard sales={data.sales} currency={currency} />
        </div>
      </div>
    </div>
  );
}
