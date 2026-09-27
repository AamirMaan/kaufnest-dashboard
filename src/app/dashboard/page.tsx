"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { type Currency } from "@/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { createTenantClient } from "@/lib/supabase/client";
import { calculateNetProfit } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import {
  resolveDateRange,
  resolveDateBounds,
  periodRange,
  describePeriod,
  PERIOD_UNIT_OPTIONS,
  type DatePreset,
  type PeriodUnit,
} from "@/lib/utils/filters";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
import { computePlatformBalance } from "./_lib/platformBalance";
import type {
  ExpensesOverview,
  OverviewTimeseries,
  PayoutsOverview,
  PurchasesOverview,
  SalesOverview,
} from "./_lib/overviewTypes";
import { RecordTransferModal } from "./_components/RecordTransferModal";
import { RevenueCard } from "./_components/RevenueCard";
import { NetProfitCard } from "./_components/NetProfitCard";
import { ExpensesCard } from "./_components/ExpensesCard";
import { PurchasesCard } from "./_components/PurchasesCard";
import { OrdersCard } from "./_components/OrdersCard";
import { VatCard } from "./_components/VatCard";
import { PlatformBalanceCard } from "./_components/PlatformBalanceCard";
import { TopProductsCard } from "./_components/TopProductsCard";

const RANGE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
const inputCls =
  "rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer";

function describeRange(range: { from: string; to: string } | null): string {
  if (!range) return "all time";
  const from = range.from === "0000-00-00" ? null : range.from;
  const to = range.to === "9999-99-99" ? null : range.to;
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `until ${formatDate(to)}`;
  return "all time";
}

export default function DashboardPage() {
  const profileCurrency: Currency =
    useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";

  const currentUserRole = useAppSelector((s) => s.currentUser.profile?.role);
  const canRecordTransfer = currentUserRole === "admin" || currentUserRole === "super_admin";
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);

  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Local UI-only state, same role as FilterBar.tsx's `customSubMode` — see
  // that component's SKILL.md entry for the full "why": computed once at
  // mount, changed afterward only by this page's own explicit dropdown pick.
  const [periodMode, setPeriodMode] = useState<"period" | "manual">(() =>
    describePeriod(dateFrom, dateTo) ? "period" : "manual"
  );
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const years = await Promise.all([
        fetchEarliestYear(async () => {
          const { data } = await supabase
            .from("sales")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data?.date ?? null;
        }),
        fetchEarliestYear(async () => {
          const { data } = await supabase
            .from("expenses")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data?.date ?? null;
        }),
        fetchEarliestYear(async () => {
          const { data } = await supabase
            .from("purchases")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data?.date ?? null;
        }),
      ]);
      if (!cancelled) setEarliestYear(Math.min(...years));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const range = useMemo(
    () => resolveDateRange(preset, dateFrom, dateTo),
    [preset, dateFrom, dateTo]
  );

  type OverviewRangeChoice = DatePreset | "specific_period";

  const overviewDisplayValue: OverviewRangeChoice =
    preset === "custom" && periodMode === "period" ? "specific_period" : preset;

  function handleRangeSelect(v: OverviewRangeChoice) {
    if (v === "specific_period") {
      setPeriodMode("period");
      const computed = periodRange(new Date().getFullYear(), "full");
      setPreset("custom");
      setDateFrom(computed.from);
      setDateTo(computed.to);
      return;
    }
    if (v === "custom") {
      setPeriodMode("manual");
    }
    setPreset(v as DatePreset);
  }

  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(earliestYear, currentYear);
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) yearOptions.push(y);

  const currentPeriod: { year: number; unit: PeriodUnit } =
    describePeriod(dateFrom, dateTo) ?? { year: currentYear, unit: "full" };

  function handlePeriodFieldChange(year: number, unit: PeriodUnit) {
    const computed = periodRange(year, unit);
    setDateFrom(computed.from);
    setDateTo(computed.to);
  }

  // Aggregates come from 5 Postgres RPCs scoped to the selected date range
  // and profile currency — NOT from state.sales.items etc. Those Redux
  // slices hold only ONE paginated page (50 rows) and get replaced whenever
  // the Sales/Expenses/Purchases pages fetch a different page, so deriving
  // date-ranged aggregates from them silently produced wrong (often empty)
  // results. The four 045 RPCs give the headline totals;
  // get_overview_timeseries (051) gives the monthly chart series, the
  // previous-period totals for the change badges, and the top vendor.
  const [salesOverview, setSalesOverview] = useState<SalesOverview | null>(null);
  const [expensesOverview, setExpensesOverview] = useState<ExpensesOverview | null>(null);
  const [purchasesOverview, setPurchasesOverview] = useState<PurchasesOverview | null>(null);
  const [payoutsOverview, setPayoutsOverview] = useState<PayoutsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<OverviewTimeseries | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      const supabase = await createTenantClient();
      // resolveDateBounds, not `range`: a one-sided custom range is
      // represented in `range` with 0000-00-00/9999-99-99 sentinels, which
      // aren't valid SQL dates. Bounds give null for the open side instead.
      const bounds = resolveDateBounds({ preset, dateFrom, dateTo });
      const rpcParams = {
        p_from: bounds.from,
        p_to: bounds.to,
        p_currency: profileCurrency,
      };

      const [salesRes, expensesRes, purchasesRes, payoutsRes, timeseriesRes] = await Promise.all([
        supabase.rpc("get_sales_overview", rpcParams),
        supabase.rpc("get_expenses_overview", rpcParams),
        supabase.rpc("get_purchases_overview", rpcParams),
        supabase.rpc("get_payouts_overview", rpcParams),
        supabase.rpc("get_overview_timeseries", rpcParams),
      ]);

      if (cancelled) return;
      if (salesRes.error) console.error("get_sales_overview failed", salesRes.error);
      if (expensesRes.error) console.error("get_expenses_overview failed", expensesRes.error);
      if (purchasesRes.error) console.error("get_purchases_overview failed", purchasesRes.error);
      if (payoutsRes.error) console.error("get_payouts_overview failed", payoutsRes.error);
      if (timeseriesRes.error) console.error("get_overview_timeseries failed", timeseriesRes.error);

      setSalesOverview(salesRes.error ? null : (salesRes.data as SalesOverview));
      setExpensesOverview(expensesRes.error ? null : (expensesRes.data as ExpensesOverview));
      setPurchasesOverview(purchasesRes.error ? null : (purchasesRes.data as PurchasesOverview));
      setPayoutsOverview(payoutsRes.error ? null : (payoutsRes.data as PayoutsOverview));
      setTimeseries(timeseriesRes.error ? null : (timeseriesRes.data as OverviewTimeseries));
      setIsLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [preset, dateFrom, dateTo, profileCurrency]);

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
        description={`Summary for ${describeRange(range)}`}
        action={
          <div className="flex items-end gap-3">
            <div>
              <span className={labelCls}>Date Range</span>
              <select
                value={overviewDisplayValue}
                onChange={(e) => handleRangeSelect(e.target.value as OverviewRangeChoice)}
                className={inputCls}
              >
                {RANGE_PRESETS.filter((p) => p.value !== "custom").map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="specific_period">Specific Period</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {preset === "custom" && periodMode === "period" && (
              <>
                <div>
                  <span className={labelCls}>Year</span>
                  <select
                    value={currentPeriod.year}
                    onChange={(e) => handlePeriodFieldChange(Number(e.target.value), currentPeriod.unit)}
                    className={inputCls}
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={labelCls}>Period</span>
                  <select
                    value={currentPeriod.unit}
                    onChange={(e) => handlePeriodFieldChange(currentPeriod.year, e.target.value as PeriodUnit)}
                    className={inputCls}
                  >
                    {PERIOD_UNIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {preset === "custom" && periodMode !== "period" && (
              <>
                <div>
                  <span className={labelCls}>From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </>
            )}
          </div>
        }
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
