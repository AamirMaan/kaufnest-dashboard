"use client";

import { useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { type Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { calculateNetProfit } from "@/lib/utils/currency";
import { computePlatformBalance } from "./_lib/platformBalance";
import { useDateRangePicker, describeRange } from "./_components/useDateRangePicker";
import { DateRangePicker } from "./_components/DateRangePicker";
import { useOverviewData } from "./_components/useOverviewData";
import { RecordTransferModal } from "./_components/RecordTransferModal";
import { RevenueCard } from "./_components/RevenueCard";
import { NetProfitCard } from "./_components/NetProfitCard";
import { ExpensesCard } from "./_components/ExpensesCard";
import { PurchasesCard } from "./_components/PurchasesCard";
import { OrdersCard } from "./_components/OrdersCard";
import { VatCard } from "./_components/VatCard";
import { PlatformBalanceCard } from "./_components/PlatformBalanceCard";
import { TopProductsCard } from "./_components/TopProductsCard";

export default function DashboardPage() {
  const profileCurrency: Currency =
    useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";

  const currentUserRole = useAppSelector((s) => s.currentUser.profile?.role);
  const canRecordTransfer = currentUserRole === "admin" || currentUserRole === "super_admin";
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);

  const picker = useDateRangePicker();
  const {
    sales: salesOverview,
    expenses: expensesOverview,
    purchases: purchasesOverview,
    payouts: payoutsOverview,
    timeseries,
    isLoading,
  } = useOverviewData(
    { preset: picker.preset, dateFrom: picker.dateFrom, dateTo: picker.dateTo },
    profileCurrency
  );

  const totalRevenue = salesOverview?.revenue ?? 0;
  const totalSaleFees = salesOverview?.fees ?? 0;
  const totalExpenses = expensesOverview?.total ?? 0;
  const totalPurchases = purchasesOverview?.total ?? 0;
  const netProfit = calculateNetProfit(totalRevenue, totalExpenses + totalSaleFees, totalPurchases);

  const vatCollected = salesOverview?.vatCollected ?? 0;
  const vatPaid = (purchasesOverview?.vatPaid ?? 0) + (expensesOverview?.vatPaid ?? 0);

  const ebayBalance = useMemo(
    () => computePlatformBalance("ebay", salesOverview, expensesOverview, payoutsOverview),
    [salesOverview, expensesOverview, payoutsOverview]
  );
  const amazonBalance = useMemo(
    () => computePlatformBalance("amazon", salesOverview, expensesOverview, payoutsOverview),
    [salesOverview, expensesOverview, payoutsOverview]
  );

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`Summary for ${describeRange(picker.range)}`}
        action={<DateRangePicker picker={picker} />}
      />

      {/* Loading overlay — subtle opacity fade while the date-range-scoped fetch is in flight */}
      <div className={isLoading ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <RevenueCard sales={salesOverview} timeseries={timeseries} currency={profileCurrency} />
          <NetProfitCard
            netProfit={netProfit}
            revenue={totalRevenue}
            timeseries={timeseries}
            currency={profileCurrency}
          />
          <ExpensesCard expenses={expensesOverview} timeseries={timeseries} currency={profileCurrency} />
          <PurchasesCard purchases={purchasesOverview} timeseries={timeseries} currency={profileCurrency} />
          <OrdersCard sales={salesOverview} timeseries={timeseries} currency={profileCurrency} />
          <VatCard
            vatCollected={vatCollected}
            vatPaid={vatPaid}
            timeseries={timeseries}
            currency={profileCurrency}
          />
          {/* Balance cards are hidden when the platform had no sales in the period */}
          {ebayBalance !== null && (
            <PlatformBalanceCard
              platform="ebay"
              balance={ebayBalance}
              currency={profileCurrency}
              onRecordTransfer={canRecordTransfer ? () => setTransferModal("ebay") : undefined}
            />
          )}
          {amazonBalance !== null && (
            <PlatformBalanceCard
              platform="amazon"
              balance={amazonBalance}
              currency={profileCurrency}
              onRecordTransfer={canRecordTransfer ? () => setTransferModal("amazon") : undefined}
            />
          )}
          <TopProductsCard sales={salesOverview} currency={profileCurrency} />
        </div>

        <div className="bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <h2 className="text-sm font-semibold text-(--color-text-base) mb-1">Quick Start</h2>
          <p className="text-sm text-(--color-text-muted)">
            Use the sidebar to navigate to Orders, Expenses, and Purchases. Figures
            above reflect the selected date range and use {profileCurrency} as the base currency.
            Change badges compare with the period of the same length just before it.
          </p>
        </div>
      </div>

      {transferModal !== null && (
        <RecordTransferModal
          platform={transferModal}
          currency={profileCurrency}
          pendingBalance={
            transferModal === "ebay"
              ? (ebayBalance?.pending ?? 0)
              : (amazonBalance?.pending ?? 0)
          }
          onClose={() => setTransferModal(null)}
          onSaved={() => setTransferModal(null)}
        />
      )}
    </div>
  );
}
