import { resolveDateBounds, type DatePreset } from "@/lib/utils/filters";

export type PayoutPlatformFilter = "all" | "ebay" | "amazon";

export interface PayoutFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  platform: PayoutPlatformFilter;
  currency: string;
}

export const DEFAULT_PAYOUT_FILTERS: PayoutFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  platform: "all",
  currency: "all",
};

/** Query predicates for `fetchPayoutsPage`; `"all"`/open bounds → `null` (no predicate). */
export interface PayoutFilterParams {
  from: string | null;
  to: string | null;
  platform: "ebay" | "amazon" | null;
  currency: string | null;
}

export function payoutFilterParams(f: PayoutFilters): PayoutFilterParams {
  const { from, to } = resolveDateBounds(f);
  return {
    from,
    to,
    platform: f.platform === "all" ? null : f.platform,
    currency: f.currency === "all" ? null : f.currency,
  };
}

export function isDefaultPayoutFilters(f: PayoutFilters): boolean {
  return (
    f.preset === "all" &&
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.platform === "all" &&
    f.currency === "all"
  );
}
