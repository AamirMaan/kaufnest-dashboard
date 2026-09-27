"use client";

import { useMemo, useState } from "react";
import { DollarSign, Landmark, ShoppingBag, TrendingUp } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import type { Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { buildKpis } from "../_lib/kpiTiles";
import { computePlatformBalance } from "../_lib/platformBalance";
import { useDateRangePicker, describeRange } from "../_components/useDateRangePicker";
import { DateRangePicker } from "../_components/DateRangePicker";
import { useOverviewData } from "../_components/useOverviewData";
import { useChartKit } from "../_components/useChartKit";
import { KpiTile } from "../_components/KpiTile";
import { RevenueCard } from "../_components/RevenueCard";
import { NetProfitCard } from "../_components/NetProfitCard";
import { ExpensesCard } from "../_components/ExpensesCard";
import { PurchasesCard } from "../_components/PurchasesCard";
import { OrdersCard } from "../_components/OrdersCard";
import { VatCard } from "../_components/VatCard";
import { PlatformBalanceCard } from "../_components/PlatformBalanceCard";
import { TopProductsCard } from "../_components/TopProductsCard";
import { RecordTransferModal } from "../_components/RecordTransferModal";

export default function AnalyticsPage() {
  const currency: Currency = useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const canRecordTransfer = role === "admin" || role === "super_admin";
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);

  const picker = useDateRangePicker();
  const data = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    currency
  );
  const kit = useChartKit(currency);
  const kpis = buildKpis(data);
  const firstLoad = data.isLoading && data.sales === null;

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
        description={`Detailed performance for ${describeRange(picker.range)}`}
        action={<DateRangePicker picker={picker} />}
      />

      <div className={data.isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <KpiTile label="Revenue" value={kit.money(kpis.revenue.value)} delta={kpis.revenue.delta}
            goodWhen="up" icon={<DollarSign size={18} />} spark={kpis.revenue.spark}
            color={kit.colors.positive} loading={firstLoad} />
          <KpiTile label="Net Profit" value={kit.money(kpis.netProfit.value)} delta={kpis.netProfit.delta}
            goodWhen="up" icon={<TrendingUp size={18} />} spark={kpis.netProfit.spark}
            color={kpis.netProfit.value >= 0 ? kit.colors.positive : kit.colors.negative} loading={firstLoad} />
          <KpiTile label="Purchases" value={kit.money(kpis.purchases.value)} delta={kpis.purchases.delta}
            goodWhen="down" icon={<ShoppingBag size={18} />} spark={kpis.purchases.spark}
            color={kit.colors.neutral} loading={firstLoad} />
          <KpiTile label={kpis.vatPosition.value >= 0 ? "VAT payable" : "VAT refundable"}
            value={kit.money(Math.abs(kpis.vatPosition.value))} delta={null}
            icon={<Landmark size={18} />} spark={kpis.vatPosition.spark}
            color={kit.colors.pending} loading={firstLoad} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RevenueCard sales={data.sales} timeseries={data.timeseries} currency={currency} />
          <NetProfitCard netProfit={kpis.netProfit.value} revenue={kpis.revenue.value}
            timeseries={data.timeseries} currency={currency} />
          <ExpensesCard expenses={data.expenses} timeseries={data.timeseries} currency={currency} />
          <PurchasesCard purchases={data.purchases} timeseries={data.timeseries} currency={currency} />
          <OrdersCard sales={data.sales} timeseries={data.timeseries} currency={currency} />
          <VatCard vatCollected={vatCollected} vatPaid={vatPaid} timeseries={data.timeseries} currency={currency} />
          {/* Balance cards are hidden when the platform had no sales in the period */}
          {ebayBalance !== null && (
            <PlatformBalanceCard platform="ebay" balance={ebayBalance} currency={currency}
              onRecordTransfer={canRecordTransfer ? () => setTransferModal("ebay") : undefined} />
          )}
          {amazonBalance !== null && (
            <PlatformBalanceCard platform="amazon" balance={amazonBalance} currency={currency}
              onRecordTransfer={canRecordTransfer ? () => setTransferModal("amazon") : undefined} />
          )}
          <TopProductsCard sales={data.sales} currency={currency} />
        </div>
      </div>

      {transferModal !== null && (
        <RecordTransferModal
          platform={transferModal}
          currency={currency}
          pendingBalance={transferModal === "ebay" ? (ebayBalance?.pending ?? 0) : (amazonBalance?.pending ?? 0)}
          onClose={() => setTransferModal(null)}
          onSaved={() => setTransferModal(null)}
        />
      )}
    </div>
  );
}
