"use client";

import { X } from "lucide-react";
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
  hasActive,
  onClear,
  children,
}: FilterBarProps) {
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
