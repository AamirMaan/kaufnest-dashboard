"use client";

import { PERIOD_UNIT_OPTIONS, type PeriodUnit } from "@/lib/utils/filters";
import { RANGE_PRESETS, type DateRangePickerState, type RangeChoice } from "./useDateRangePicker";

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
const inputCls =
  "rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer";

export function DateRangePicker({ picker }: { picker: DateRangePickerState }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <span className={labelCls}>Date Range</span>
        <select
          value={picker.displayValue}
          onChange={(e) => picker.onRangeSelect(e.target.value as RangeChoice)}
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
      {picker.preset === "custom" && picker.periodMode === "period" && (
        <>
          <div>
            <span className={labelCls}>Year</span>
            <select
              value={picker.currentPeriod.year}
              onChange={(e) =>
                picker.onPeriodFieldChange(Number(e.target.value), picker.currentPeriod.unit)
              }
              className={inputCls}
            >
              {picker.yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={labelCls}>Period</span>
            <select
              value={picker.currentPeriod.unit}
              onChange={(e) =>
                picker.onPeriodFieldChange(picker.currentPeriod.year, e.target.value as PeriodUnit)
              }
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
      {picker.preset === "custom" && picker.periodMode !== "period" && (
        <>
          <div>
            <span className={labelCls}>From</span>
            <input
              type="date"
              value={picker.dateFrom}
              onChange={(e) => picker.setDateFrom(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <span className={labelCls}>To</span>
            <input
              type="date"
              value={picker.dateTo}
              onChange={(e) => picker.setDateTo(e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}
    </div>
  );
}
