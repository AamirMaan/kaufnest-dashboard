"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
} from "recharts";
import { DollarSign, TrendingDown, ShoppingCart, BarChart3, Package } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { type Currency } from "@/types";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { CategoryBadge } from "@/components/ui/Badge";
import { useTheme } from "@/components/ui/ThemeProvider";
import { formatCurrency, calculateNetProfit } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { resolveDateRange, isRevenueSale, type DatePreset } from "@/lib/utils/filters";
import { aggregateSaleRevenue } from "./_lib/aggregateSales";
import { computePending } from "./_lib/platformBalance";
import { RecordTransferModal } from "./_components/RecordTransferModal";
import type { ExpenseCategory } from "@/types";

const RANGE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

const PLATFORM_COLORS: Record<string, string> = {
  amazon:  "#F59E0B",
  ebay:    "#3B82F6",
  etsy:    "#EF4444",
  shopify: "#10B981",
  other:   "#8B5CF6",
};
const FALLBACK_COLORS = ["#6366F1", "#EC4899", "#14B8A6", "#F97316", "#84CC16"];

function platformColor(key: string, index: number): string {
  return PLATFORM_COLORS[key.toLowerCase()] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
const inputCls =
  "rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer";
const cardCls =
  "bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6";

function describeRange(range: { from: string; to: string } | null): string {
  if (!range) return "all time";
  const from = range.from === "0000-00-00" ? null : range.from;
  const to = range.to === "9999-99-99" ? null : range.to;
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `until ${formatDate(to)}`;
  return "all time";
}

function compactEur(v: number): string {
  if (v === 0) return "€0";
  if (Math.abs(v) >= 1000) return `€${(v / 1000).toFixed(0)}k`;
  return `€${v.toFixed(0)}`;
}

export default function DashboardPage() {
  const sales = useAppSelector((s) => s.sales.items);
  const expenses = useAppSelector((s) => s.expenses.items);
  const purchases = useAppSelector((s) => s.purchases.items);
  const profileCurrency: Currency =
    useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const { theme } = useTheme();

  const payouts = useAppSelector((s) => s.platformPayouts.items);
  const currentUserRole = useAppSelector((s) => s.currentUser.profile?.role);
  const canRecordTransfer = currentUserRole === "admin" || currentUserRole === "super_admin";
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);

  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const range = useMemo(
    () => resolveDateRange(preset, dateFrom, dateTo),
    [preset, dateFrom, dateTo]
  );

  // Guard against multi-currency totals: only include records in the profile
  // currency so EUR + USD + GBP are never summed into a single meaningless number.
  const periodSales = useMemo(
    () =>
      sales.filter(
        (s) =>
          s.currency === profileCurrency &&
          (range ? s.date >= range.from && s.date <= range.to : true)
      ),
    [sales, range, profileCurrency]
  );
  const periodExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          e.currency === profileCurrency &&
          (range ? e.date >= range.from && e.date <= range.to : true)
      ),
    [expenses, range, profileCurrency]
  );
  const periodPurchases = useMemo(
    () =>
      purchases.filter(
        (p) =>
          p.currency === profileCurrency &&
          (range ? p.date >= range.from && p.date <= range.to : true)
      ),
    [purchases, range, profileCurrency]
  );
  const periodPayouts = useMemo(
    () =>
      payouts.filter(
        (p) =>
          p.currency === profileCurrency &&
          (range ? p.date >= range.from && p.date <= range.to : true)
      ),
    [payouts, range, profileCurrency]
  );

  // Returned/cancelled orders don't contribute to revenue/profit — exclude them
  // from every revenue-derived figure below, but keep periodSales.length (total
  // orders placed, including returns/cancellations) for the "Orders" StatCard.
  const effectiveSales = useMemo(
    () => periodSales.filter(isRevenueSale),
    [periodSales]
  );

  const { revenue: totalRevenue, fees: totalSaleFees } = useMemo(
    () => aggregateSaleRevenue(effectiveSales),
    [effectiveSales]
  );
  const totalExpenses = periodExpenses.reduce((s, r) => s + r.amount, 0);
  const totalPurchases = periodPurchases.reduce((s, r) => s + r.total_amount, 0);
  const netProfit = calculateNetProfit(totalRevenue, totalExpenses + totalSaleFees, totalPurchases);
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : null;
  const avgOrderValue = effectiveSales.length > 0 ? totalRevenue / effectiveSales.length : null;
  const unitsSold = effectiveSales.reduce((s, r) => s + r.quantity, 0);

  // VAT position
  const vatCollected = effectiveSales.reduce((s, r) => s + (r.vat_amount ?? 0), 0);
  const vatPaid =
    periodPurchases.reduce((s, r) => s + (r.vat_amount ?? 0), 0) +
    periodExpenses.reduce((s, r) => s + (r.vat_amount ?? 0), 0);
  const vatPosition = vatCollected - vatPaid;
  const hasVatData = vatCollected > 0 || vatPaid > 0;

  // Monthly trend data — grouped by YYYY-MM
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { revenue: number; expenses: number; purchases: number }>();
    const get = (k: string) => map.get(k) ?? { revenue: 0, expenses: 0, purchases: 0 };

    // Group sales by month and use aggregateSaleRevenue per month
    const salesByMonth = new Map<string, typeof effectiveSales>();
    for (const s of effectiveSales) {
      const k = s.date.slice(0, 7);
      if (!salesByMonth.has(k)) salesByMonth.set(k, []);
      salesByMonth.get(k)!.push(s);
    }
    for (const [k, monthlySales] of salesByMonth) {
      const { revenue } = aggregateSaleRevenue(monthlySales);
      const e = get(k);
      map.set(k, { ...e, revenue });
    }

    for (const e of periodExpenses) {
      const k = e.date.slice(0, 7);
      const entry = get(k);
      map.set(k, { ...entry, expenses: entry.expenses + e.amount });
    }
    for (const p of periodPurchases) {
      const k = p.date.slice(0, 7);
      const entry = get(k);
      map.set(k, { ...entry, purchases: entry.purchases + p.total_amount });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, data]) => ({
        month: new Date(`${ym}-15`).toLocaleString("default", { month: "short", year: "2-digit" }),
        ...data,
      }));
  }, [effectiveSales, periodExpenses, periodPurchases]);

  // Revenue by platform — includes fill colour so recharts v3 Pie can skip Cell
  const platformData = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of effectiveSales) {
      map.set(s.platform, (map.get(s.platform) ?? 0) + s.total_amount);
    }
    return Array.from(map.entries())
      .map(([key, value], index) => ({
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value,
        fill: platformColor(key, index),
      }))
      .sort((a, b) => b.value - a.value);
  }, [effectiveSales]);

  // Top 5 products by revenue
  const topProducts = useMemo(() => {
    const map = new Map<string, { revenue: number; units: number }>();
    for (const s of effectiveSales) {
      const e = map.get(s.product_name) ?? { revenue: 0, units: 0 };
      map.set(s.product_name, { revenue: e.revenue + s.total_amount, units: e.units + s.quantity });
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [effectiveSales]);

  // Expenses by category
  const expensesByCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const e of periodExpenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [periodExpenses]);

  // Platform balance helpers: gross sales minus ad fees, outbound shipping, and any
  // periodExpenses whose vendor or title contains the platform name (case-insensitive).
  // Returns null when there are no effective sales for that platform (card is hidden).
  const ebayBalance = useMemo(() => {
    const ebaySales = effectiveSales.filter((s) => s.platform === "ebay");
    if (ebaySales.length === 0) return null;
    const sales = ebaySales.reduce((acc, s) => acc + s.total_amount, 0);
    const adFees = ebaySales.reduce((acc, s) => acc + (s.advertising_fee ?? 0), 0);
    const shippingFees = ebaySales.reduce((acc, s) => acc + (s.shipping_cost ?? 0), 0);
    const expenses = periodExpenses
      .filter((e) => e.vendor?.toLowerCase().includes("ebay") || e.title.toLowerCase().includes("ebay"))
      .reduce((acc, e) => acc + e.amount, 0);
    const balance = sales - adFees - shippingFees - expenses;
    const ebayPayouts = periodPayouts.filter((p) => p.platform === "ebay");
    const transferred = ebayPayouts.reduce((acc, p) => acc + p.amount, 0);
    return {
      balance,
      sales,
      adFees,
      shippingFees,
      expenses,
      transferred,
      pending: computePending(balance, ebayPayouts),
      count: ebaySales.length,
    };
  }, [effectiveSales, periodExpenses, periodPayouts]);

  const amazonBalance = useMemo(() => {
    const amazonSales = effectiveSales.filter((s) => s.platform === "amazon");
    if (amazonSales.length === 0) return null;
    const sales = amazonSales.reduce((acc, s) => acc + s.total_amount, 0);
    const adFees = amazonSales.reduce((acc, s) => acc + (s.advertising_fee ?? 0), 0);
    const shippingFees = amazonSales.reduce((acc, s) => acc + (s.shipping_cost ?? 0), 0);
    const expenses = periodExpenses
      .filter((e) => e.vendor?.toLowerCase().includes("amazon") || e.title.toLowerCase().includes("amazon"))
      .reduce((acc, e) => acc + e.amount, 0);
    const balance = sales - adFees - shippingFees - expenses;
    const amazonPayouts = periodPayouts.filter((p) => p.platform === "amazon");
    const transferred = amazonPayouts.reduce((acc, p) => acc + p.amount, 0);
    return {
      balance,
      sales,
      adFees,
      shippingFees,
      expenses,
      transferred,
      pending: computePending(balance, amazonPayouts),
      count: amazonSales.length,
    };
  }, [effectiveSales, periodExpenses, periodPayouts]);

  const showCharts = periodSales.length > 0 || periodExpenses.length > 0 || periodPurchases.length > 0;

  // Chart palette — recharts props are SVG attributes so CSS vars don't reliably resolve there;
  // use concrete hex values derived from the current theme instead.
  const isDark = theme === "dark";
  const gridColor    = isDark ? "#334155" : "#e2e8f0";
  const tickColor    = isDark ? "#94a3b8" : "#64748b";
  const tooltipBg    = isDark ? "#1e293b" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#e2e8f0";
  const tooltipLabel = isDark ? "#cbd5e1" : "#334155";

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
                value={preset}
                onChange={(e) => setPreset(e.target.value as DatePreset)}
                className={inputCls}
              >
                {RANGE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            {preset === "custom" && (
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

      {/* KPI stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard
          label="Revenue"
          value={formatCurrency(totalRevenue, profileCurrency)}
          trend="up"
          subtext={avgOrderValue !== null ? `Avg. order: ${formatCurrency(avgOrderValue, profileCurrency)}` : undefined}
          icon={<DollarSign size={18} />}
        />
        <StatCard
          label="Expenses"
          value={formatCurrency(totalExpenses, profileCurrency)}
          trend="down"
          icon={<TrendingDown size={18} />}
        />
        <StatCard
          label="Purchases"
          value={formatCurrency(totalPurchases, profileCurrency)}
          trend="down"
          icon={<ShoppingCart size={18} />}
        />
        <StatCard
          label="Net Profit"
          value={formatCurrency(netProfit, profileCurrency)}
          trend={netProfit >= 0 ? "up" : "down"}
          subtext={
            profitMargin !== null
              ? `${profitMargin.toFixed(1)}% margin`
              : netProfit >= 0
              ? "Profitable in this period"
              : "Loss in this period"
          }
          icon={<BarChart3 size={18} />}
        />
        <StatCard
          label="Orders"
          value={periodSales.length.toLocaleString()}
          subtext={`${unitsSold} unit${unitsSold !== 1 ? "s" : ""} sold`}
          trend="neutral"
          icon={<Package size={18} />}
        />
      </div>

      {/* Platform balances — hidden when no sales for that platform in the period */}
      {(ebayBalance !== null || amazonBalance !== null) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {ebayBalance !== null && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-(--color-text-base)">
                  eBay Balance
                  <span className="ml-2 text-xs font-normal text-(--color-text-faint)">
                    {ebayBalance.count} order{ebayBalance.count !== 1 ? "s" : ""}
                  </span>
                </h2>
                {canRecordTransfer && (
                  <button
                    onClick={() => setTransferModal("ebay")}
                    className="text-xs font-medium px-2.5 py-1 rounded-(--radius-btn) bg-(--color-primary-muted) text-(--color-primary-text) hover:bg-(--color-primary) hover:text-white transition-colors cursor-pointer"
                  >
                    Record Transfer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Sales"
                  value={formatCurrency(ebayBalance.sales, profileCurrency)}
                  trend="neutral"
                  subtext="Gross revenue"
                />
                <StatCard
                  label="Ad Fees + Shipping"
                  value={formatCurrency(ebayBalance.adFees + ebayBalance.shippingFees, profileCurrency)}
                  trend="down"
                  subtext={`${formatCurrency(ebayBalance.adFees, profileCurrency)} ads · ${formatCurrency(ebayBalance.shippingFees, profileCurrency)} ship`}
                />
                <StatCard
                  label="Expenses"
                  value={formatCurrency(ebayBalance.expenses, profileCurrency)}
                  trend="down"
                  subtext="Vendor/title contains &quot;eBay&quot;"
                />
                <StatCard
                  label="Balance Earned"
                  value={formatCurrency(ebayBalance.balance, profileCurrency)}
                  trend={ebayBalance.balance >= 0 ? "up" : "down"}
                  subtext="Sales − fees − expenses"
                />
                <StatCard
                  label="Transferred"
                  value={formatCurrency(ebayBalance.transferred, profileCurrency)}
                  trend="neutral"
                  subtext="Paid out to bank"
                />
                <StatCard
                  label="Pending"
                  value={formatCurrency(ebayBalance.pending, profileCurrency)}
                  trend={ebayBalance.pending >= 0 ? "up" : "down"}
                  subtext="Still in eBay account"
                />
              </div>
            </div>
          )}

          {amazonBalance !== null && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-(--color-text-base)">
                  Amazon Balance
                  <span className="ml-2 text-xs font-normal text-(--color-text-faint)">
                    {amazonBalance.count} order{amazonBalance.count !== 1 ? "s" : ""}
                  </span>
                </h2>
                {canRecordTransfer && (
                  <button
                    onClick={() => setTransferModal("amazon")}
                    className="text-xs font-medium px-2.5 py-1 rounded-(--radius-btn) bg-(--color-primary-muted) text-(--color-primary-text) hover:bg-(--color-primary) hover:text-white transition-colors cursor-pointer"
                  >
                    Record Transfer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Sales"
                  value={formatCurrency(amazonBalance.sales, profileCurrency)}
                  trend="neutral"
                  subtext="Gross revenue"
                />
                <StatCard
                  label="Ad Fees + Shipping"
                  value={formatCurrency(amazonBalance.adFees + amazonBalance.shippingFees, profileCurrency)}
                  trend="down"
                  subtext={`${formatCurrency(amazonBalance.adFees, profileCurrency)} ads · ${formatCurrency(amazonBalance.shippingFees, profileCurrency)} ship`}
                />
                <StatCard
                  label="Expenses"
                  value={formatCurrency(amazonBalance.expenses, profileCurrency)}
                  trend="down"
                  subtext="Vendor/title contains &quot;Amazon&quot;"
                />
                <StatCard
                  label="Balance Earned"
                  value={formatCurrency(amazonBalance.balance, profileCurrency)}
                  trend={amazonBalance.balance >= 0 ? "up" : "down"}
                  subtext="Sales − fees − expenses"
                />
                <StatCard
                  label="Transferred"
                  value={formatCurrency(amazonBalance.transferred, profileCurrency)}
                  trend="neutral"
                  subtext="Paid out to bank"
                />
                <StatCard
                  label="Pending"
                  value={formatCurrency(amazonBalance.pending, profileCurrency)}
                  trend={amazonBalance.pending >= 0 ? "up" : "down"}
                  subtext="Still in Amazon account"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Charts — hidden when there is no data in the period */}
      {showCharts && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {/* Monthly Trend — 2/3 width */}
          <div className={`${cardCls} lg:col-span-2`} style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-5">Monthly Trend</h2>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyTrend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-revenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-expenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#dc2626" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-purchases" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d97706" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: tickColor }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: tickColor }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={compactEur}
                />
                <Tooltip
                  contentStyle={{
                    background: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: tooltipLabel, marginBottom: 4, fontWeight: 600 }}
                  formatter={(value, name) => [
                    formatCurrency(Number(value ?? 0), profileCurrency),
                    String(name ?? "").charAt(0).toUpperCase() + String(name ?? "").slice(1),
                  ]}
                />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={{ fontSize: 12, paddingTop: 10, color: tickColor }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#grad-revenue)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  name="Expenses"
                  stroke="#dc2626"
                  strokeWidth={2}
                  fill="url(#grad-expenses)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="purchases"
                  name="Purchases"
                  stroke="#d97706"
                  strokeWidth={2}
                  fill="url(#grad-purchases)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Revenue by Platform donut — 1/3 width */}
          {platformData.length > 0 && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <h2 className="text-sm font-semibold text-(--color-text-base) mb-3">Revenue by Platform</h2>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={platformData}
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={68}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  />
                  <Tooltip
                    contentStyle={{
                      background: tooltipBg,
                      border: `1px solid ${tooltipBorder}`,
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                    }}
                    labelStyle={{ display: "none" }}
                    formatter={(value, name) => [formatCurrency(Number(value ?? 0), profileCurrency), String(name ?? "")]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Custom platform legend */}
              <div className="space-y-2 mt-2">
                {platformData.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.fill }} />
                      <span className="text-(--color-text-muted) truncate">{entry.name}</span>
                    </div>
                    <span className="font-medium tabular-nums text-(--color-text-base) ml-2">
                      {formatCurrency(entry.value, profileCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VAT Position */}
      {hasVatData && (
        <div className={`${cardCls} mb-8`} style={{ boxShadow: "var(--shadow-card)" }}>
          <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">VAT Position</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="VAT Collected"
              value={formatCurrency(vatCollected, profileCurrency)}
              subtext="Output VAT — charged to customers"
              trend="neutral"
            />
            <StatCard
              label="VAT Paid"
              value={formatCurrency(vatPaid, profileCurrency)}
              subtext="Input VAT — purchases & expenses"
              trend="neutral"
            />
            <StatCard
              label={vatPosition >= 0 ? "Due to Government" : "Government Refund"}
              value={formatCurrency(Math.abs(vatPosition), profileCurrency)}
              subtext={vatPosition >= 0 ? "Net VAT payable" : "Net VAT reclaimable"}
              trend={vatPosition >= 0 ? "down" : "up"}
            />
          </div>
        </div>
      )}

      {/* Top Products + Expenses by Category side-by-side */}
      {(topProducts.length > 0 || expensesByCategory.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {topProducts.length > 0 && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">Top Products</h2>
              <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-(--color-text-faint) w-4 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-(--color-text-base) truncate max-w-[60%]">
                          {p.name}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-(--color-success)">
                          {formatCurrency(p.revenue)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-(--color-border)">
                        <div
                          className="h-full rounded-full bg-(--color-success)"
                          style={{ width: `${(p.revenue / topProducts[0].revenue) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-(--color-text-faint) shrink-0 w-14 text-right">
                      {p.units} unit{p.units !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expensesByCategory.length > 0 && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">Expenses by Category</h2>
              <div className="divide-y divide-(--color-border)">
                {expensesByCategory.map(([category, amount]) => (
                  <div key={category} className="flex items-center justify-between py-2.5">
                    <CategoryBadge category={category} />
                    <span className="text-sm font-semibold tabular-nums text-(--color-danger)">
                      {formatCurrency(amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
        <h2 className="text-sm font-semibold text-(--color-text-base) mb-1">Quick Start</h2>
        <p className="text-sm text-(--color-text-muted)">
          Use the sidebar to navigate to Orders, Expenses, and Purchases. Figures
          above reflect the selected date range and use EUR as the base currency.
        </p>
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
