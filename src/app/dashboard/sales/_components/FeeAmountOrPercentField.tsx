"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/FormFields";
import { formatCurrency, computeFeeFromPercent } from "@/lib/utils/currency";
import type { Currency } from "@/types";

interface Props {
  label: string;
  /** Flat amount string — the single source of truth the parent form stores.
   * Percentage mode is purely an entry convenience: it's never persisted,
   * only used to compute this flat value at input time. */
  value: string;
  onChange: (value: string) => void;
  /** qty × unit_price — the base a percentage is computed against. */
  itemTotal: number;
  currency: Currency;
}

type Mode = "amount" | "percent";

const toggleBtnCls = (active: boolean) =>
  `px-2 py-1.5 text-xs ${
    active
      ? "bg-(--color-primary) text-white"
      : "text-(--color-text-muted) hover:bg-(--color-surface-subtle)"
  }`;

/**
 * A fee input that can be entered as a flat amount OR as a percentage of
 * `itemTotal` — switching to "%" computes and stores the resulting flat
 * amount via `onChange`, same as typing it directly. Reopening an existing
 * record always shows amount mode, since the percentage itself isn't stored.
 */
export function FeeAmountOrPercentField({ label, value, onChange, itemTotal, currency }: Props) {
  const [mode, setMode] = useState<Mode>("amount");
  const [percentInput, setPercentInput] = useState("");

  function handlePercentChange(raw: string) {
    setPercentInput(raw);
    const pct = parseFloat(raw);
    if (raw.trim() === "" || isNaN(pct)) {
      onChange("");
      return;
    }
    onChange(computeFeeFromPercent(itemTotal, pct).toFixed(2));
  }

  const parsedPercent = parseFloat(percentInput);
  const previewAmount =
    percentInput.trim() !== "" && !isNaN(parsedPercent)
      ? computeFeeFromPercent(itemTotal, parsedPercent)
      : null;

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-(--radius-btn) border border-(--color-border)">
          <button type="button" onClick={() => setMode("amount")} className={toggleBtnCls(mode === "amount")}>
            €
          </button>
          <button
            type="button"
            onClick={() => setMode("percent")}
            className={`border-l border-(--color-border) ${toggleBtnCls(mode === "percent")}`}
          >
            %
          </button>
        </div>
        {mode === "amount" ? (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0.00"
          />
        ) : (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={percentInput}
            onChange={(e) => handlePercentChange(e.target.value)}
            placeholder="0"
          />
        )}
      </div>
      {mode === "percent" && previewAmount !== null && (
        <p className="text-xs text-(--color-text-muted)">
          ≈ {formatCurrency(previewAmount, currency)} of {formatCurrency(itemTotal, currency)} item total
        </p>
      )}
    </Field>
  );
}
