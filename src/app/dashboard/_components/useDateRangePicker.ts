"use client";

import { useEffect, useMemo, useState } from "react";
import { createTenantClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/date";
import {
  describePeriod,
  periodRange,
  resolveDateRange,
  type DatePreset,
  type PeriodUnit,
} from "@/lib/utils/filters";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";

export const RANGE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

export type RangeChoice = DatePreset | "specific_period";

export function describeRange(range: { from: string; to: string } | null): string {
  if (!range) return "all time";
  const from = range.from === "0000-00-00" ? null : range.from;
  const to = range.to === "9999-99-99" ? null : range.to;
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `until ${formatDate(to)}`;
  return "all time";
}

export interface DateRangePickerState {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  periodMode: "period" | "manual";
  range: { from: string; to: string } | null;
  displayValue: RangeChoice;
  onRangeSelect: (v: RangeChoice) => void;
  yearOptions: number[];
  currentPeriod: { year: number; unit: PeriodUnit };
  onPeriodFieldChange: (year: number, unit: PeriodUnit) => void;
}

/** Date-range picker state shared by Home and Analytics (one instance per page). */
export function useDateRangePicker(): DateRangePickerState {
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

  const range = useMemo(() => resolveDateRange(preset, dateFrom, dateTo), [preset, dateFrom, dateTo]);

  const displayValue: RangeChoice =
    preset === "custom" && periodMode === "period" ? "specific_period" : preset;

  function onRangeSelect(v: RangeChoice) {
    if (v === "specific_period") {
      setPeriodMode("period");
      const computed = periodRange(new Date().getFullYear(), "full");
      setPreset("custom");
      setDateFrom(computed.from);
      setDateTo(computed.to);
      return;
    }
    if (v === "custom") setPeriodMode("manual");
    setPreset(v);
  }

  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(earliestYear, currentYear);
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) yearOptions.push(y);

  const currentPeriod = describePeriod(dateFrom, dateTo) ?? { year: currentYear, unit: "full" as PeriodUnit };

  function onPeriodFieldChange(year: number, unit: PeriodUnit) {
    const computed = periodRange(year, unit);
    setDateFrom(computed.from);
    setDateTo(computed.to);
  }

  return {
    preset, dateFrom, dateTo, setDateFrom, setDateTo, periodMode, range,
    displayValue, onRangeSelect, yearOptions, currentPeriod, onPeriodFieldChange,
  };
}
