"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./Button";
import type { DatePreset } from "@/lib/utils/filters";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

const CURRENCIES = ["all", "EUR", "USD", "GBP"] as const;

const inputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer";

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
      {children}
    </span>
  );
}

export interface FilterBarProps {
  preset: DatePreset;
  onPresetChange: (v: DatePreset) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  currency?: string;
  onCurrencyChange?: (v: string) => void;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  hasActive: boolean;
  onClear: () => void;
  /** Entity-specific filter slots */
  children?: React.ReactNode;
}

export function FilterBar({
  preset,
  onPresetChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  currency,
  onCurrencyChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  hasActive,
  onClear,
  children,
}: FilterBarProps) {
  const [localSearch, setLocalSearch] = useState(searchValue ?? "");
  const [prevSearchValue, setPrevSearchValue] = useState(searchValue);

  // Keep local state in sync when the parent resets/changes the value
  // externally (e.g. the "Clear" button, or switching tabs). Adjusted during
  // render (React's "you might not need an effect" pattern) rather than in a
  // useEffect, since an unconditional setState-in-effect trips this project's
  // react-hooks/set-state-in-effect lint rule and causes an extra render pass.
  if (searchValue !== prevSearchValue) {
    setPrevSearchValue(searchValue);
    setLocalSearch(searchValue ?? "");
  }

  // Latest-callback ref so the debounce effect doesn't need `onSearchChange`
  // in its deps — that prop is a new function identity on every parent
  // render, which would otherwise restart the timer before it ever fires.
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    if (!onSearchChangeRef.current || localSearch === searchValue) return;
    const handle = setTimeout(() => onSearchChangeRef.current?.(localSearch), 400);
    return () => clearTimeout(handle);
  }, [localSearch, searchValue]);

  return (
    <div className="mb-4 grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3">
      {/* Date preset */}
      <div>
        <FilterLabel>Date Range</FilterLabel>
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as DatePreset)}
          className={inputCls}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Custom date inputs */}
      {preset === "custom" && (
        <>
          <div>
            <FilterLabel>From</FilterLabel>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <FilterLabel>To</FilterLabel>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}

      {/* Currency — hidden when the feature has no currency filter */}
      {currency !== undefined && onCurrencyChange !== undefined && (
        <div>
          <FilterLabel>Currency</FilterLabel>
          <select
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
            className={inputCls}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All Currencies" : c}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Entity-specific slot */}
      {children}

      {/* Free-text search — hidden when the feature has no search handler.
          Rendered after the entity-specific dropdowns so it reads as the
          catch-all search sitting to the right of the more specific filters. */}
      {onSearchChange !== undefined && (
        <div className="col-span-2 sm:flex-1 sm:min-w-[220px]">
          <FilterLabel>Search</FilterLabel>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
            />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder={searchPlaceholder ?? "Search…"}
              className={`${inputCls} w-full pl-7 cursor-text`}
            />
          </div>
        </div>
      )}

      {/* Clear button */}
      {hasActive && (
        <div>
          <FilterLabel>&nbsp;</FilterLabel>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X size={13} />
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
