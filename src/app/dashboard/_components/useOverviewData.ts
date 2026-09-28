"use client";

import { useEffect, useState } from "react";
import { createTenantClient } from "@/lib/supabase/client";
import { resolveDateBounds, type DatePreset } from "@/lib/utils/filters";
import type { Currency } from "@/types";
import { trailingRange } from "../_lib/kpiTiles";
import type {
  ExpensesOverview,
  MarketplaceRow,
  OverviewTimeseries,
  PayoutsOverview,
  PurchasesOverview,
  SalesOverview,
} from "../_lib/overviewTypes";

export interface OverviewData {
  sales: SalesOverview | null;
  expenses: ExpensesOverview | null;
  purchases: PurchasesOverview | null;
  payouts: PayoutsOverview | null;
  timeseries: OverviewTimeseries | null;
  marketplaces: MarketplaceRow[] | null;
  /** Trailing 12 months, independent of the picked range — feeds sparklines + Home's trend chart. */
  trailing: OverviewTimeseries | null;
  /** True until the trailing call first resolves (success or error), and true again while it refetches on a currency change. */
  trailingLoading: boolean;
  isLoading: boolean;
}

/**
 * Range-scoped aggregates for Home and Analytics. Comes from 6 Postgres RPCs,
 * NOT from state.sales.items etc. Those Redux slices hold only ONE paginated
 * page (50 rows) and get replaced whenever the Sales/Expenses/Purchases pages
 * fetch a different page, so deriving date-ranged aggregates from them
 * silently produced wrong (often empty) results. The four 045 RPCs give the
 * headline totals; get_overview_timeseries (051) gives the monthly chart
 * series, the previous-period totals for the change badges, and the top
 * vendor; get_sales_by_marketplace (052) gives the per-marketplace revenue/
 * VAT/VAT-base breakdown for Analytics' MarketplaceCard.
 */
export function useOverviewData(
  filter: { preset: DatePreset; dateFrom: string; dateTo: string },
  currency: Currency
): OverviewData {
  const { preset, dateFrom, dateTo } = filter;
  const [sales, setSales] = useState<SalesOverview | null>(null);
  const [expenses, setExpenses] = useState<ExpensesOverview | null>(null);
  const [purchases, setPurchases] = useState<PurchasesOverview | null>(null);
  const [payouts, setPayouts] = useState<PayoutsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<OverviewTimeseries | null>(null);
  const [marketplaces, setMarketplaces] = useState<MarketplaceRow[] | null>(null);
  const [trailing, setTrailing] = useState<OverviewTimeseries | null>(null);
  const [trailingLoading, setTrailingLoading] = useState(true);
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
        p_currency: currency,
      };

      const [salesRes, expensesRes, purchasesRes, payoutsRes, timeseriesRes, marketplacesRes] = await Promise.all([
        supabase.rpc("get_sales_overview", rpcParams),
        supabase.rpc("get_expenses_overview", rpcParams),
        supabase.rpc("get_purchases_overview", rpcParams),
        supabase.rpc("get_payouts_overview", rpcParams),
        supabase.rpc("get_overview_timeseries", rpcParams),
        supabase.rpc("get_sales_by_marketplace", rpcParams),
      ]);

      if (cancelled) return;
      if (salesRes.error) console.error("get_sales_overview failed", salesRes.error);
      if (expensesRes.error) console.error("get_expenses_overview failed", expensesRes.error);
      if (purchasesRes.error) console.error("get_purchases_overview failed", purchasesRes.error);
      if (payoutsRes.error) console.error("get_payouts_overview failed", payoutsRes.error);
      if (timeseriesRes.error) console.error("get_overview_timeseries failed", timeseriesRes.error);
      if (marketplacesRes.error) console.error("get_sales_by_marketplace failed", marketplacesRes.error);

      setSales(salesRes.error ? null : (salesRes.data as SalesOverview));
      setExpenses(expensesRes.error ? null : (expensesRes.data as ExpensesOverview));
      setPurchases(purchasesRes.error ? null : (purchasesRes.data as PurchasesOverview));
      setPayouts(payoutsRes.error ? null : (payoutsRes.data as PayoutsOverview));
      setTimeseries(timeseriesRes.error ? null : (timeseriesRes.data as OverviewTimeseries));
      setMarketplaces(marketplacesRes.error ? null : (marketplacesRes.data as MarketplaceRow[]));
      setIsLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [preset, dateFrom, dateTo, currency]);

  // Trailing window: refetched only when the currency changes, not on every range pick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTrailingLoading(true);
      const supabase = await createTenantClient();
      const { from, to } = trailingRange(new Date());
      const { data, error } = await supabase.rpc("get_overview_timeseries", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (cancelled) return;
      if (error) console.error("get_overview_timeseries (trailing) failed", error);
      setTrailing(error ? null : (data as OverviewTimeseries));
      setTrailingLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currency]);

  return { sales, expenses, purchases, payouts, timeseries, marketplaces, trailing, trailingLoading, isLoading };
}
