"use client";

import { formatCurrency } from "@/lib/utils/currency";
import type { CalcResult, VatMode } from "../_lib/calculations";

interface PlannerResultsProps {
  result: CalcResult | null;
  vatMode: VatMode;
  shippingLabel: string;
  customChargeLabel?: string;
}

export function PlannerResults({ result, vatMode, shippingLabel, customChargeLabel }: PlannerResultsProps) {
  const minPriceLabel =
    vatMode === "inclusive"
      ? "Min. selling price (incl. VAT)"
      : "Min. selling price (excl. VAT)";

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-6">
      <div className="space-y-3">
        <ResultRow
          label="Profit"
          value={result ? formatCurrency(result.profit) : "—"}
          valueClassName={
            result
              ? result.profit >= 0
                ? "text-[var(--color-success)]"
                : "text-[var(--color-danger)]"
              : "text-[var(--color-text-muted)]"
          }
        />
        <ResultRow
          label="Profit margin"
          value={result ? `${result.profitMargin.toFixed(1)} %` : "—"}
          valueClassName={
            result
              ? result.profitMargin >= 0
                ? "text-[var(--color-success)]"
                : "text-[var(--color-danger)]"
              : "text-[var(--color-text-muted)]"
          }
        />
        <ResultRow
          label={minPriceLabel}
          value={
            result
              ? result.minSellingPrice === Infinity
                ? "N/A"
                : formatCurrency(result.minSellingPrice)
              : "—"
          }
        />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
          Fee Breakdown
        </p>
        <div className="space-y-2">
          <ResultRow
            label="Platform fee"
            value={result ? formatCurrency(result.breakdown.platformFee) : "—"}
            small
          />
          <ResultRow
            label="VAT collected"
            value={result ? formatCurrency(result.breakdown.vatCollected) : "—"}
            small
          />
          <ResultRow
            label={shippingLabel}
            value={result ? formatCurrency(result.breakdown.fixedCosts) : "—"}
            small
          />
          <ResultRow
            label="Advertising"
            value={result ? formatCurrency(result.breakdown.advertisingCost) : "—"}
            small
          />
          {customChargeLabel && (
            <ResultRow
              label={customChargeLabel}
              value={result ? formatCurrency(result.breakdown.customCharge) : "—"}
              small
            />
          )}
        </div>
      </div>

      {!result && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Enter a selling price and purchase cost to see results.
        </p>
      )}
    </div>
  );
}

interface ResultRowProps {
  label: string;
  value: string;
  valueClassName?: string;
  small?: boolean;
}

function ResultRow({ label, value, valueClassName, small }: ResultRowProps) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={
          small
            ? "text-xs text-[var(--color-text-muted)]"
            : "text-sm font-medium text-[var(--color-text)]"
        }
      >
        {label}
      </span>
      <span
        className={[
          small ? "text-xs" : "text-sm font-semibold",
          valueClassName ?? "text-[var(--color-text-strong)]",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
