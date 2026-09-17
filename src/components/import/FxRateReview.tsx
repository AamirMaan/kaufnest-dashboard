"use client";

import { Select, Input } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { isReviewComplete, type FxReviewState, type FxReviewAction } from "./fxReviewState";

export interface FxRateReviewRow {
  currency: string;
  rowCount: number;
  dateSpan: { from: string; to: string };
}

interface FxRateReviewProps {
  rows: FxRateReviewRow[];
  state: FxReviewState;
  dispatch: React.Dispatch<FxReviewAction>;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}

export function FxRateReview({ rows, state, dispatch, onCancel, onConfirm, confirming }: FxRateReviewProps) {
  const complete = isReviewComplete(state);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        This file has rows in a currency other than your account&apos;s base
        currency. Review the conversion rate for each before importing.
      </p>
      <form id="fx-rate-review-form" onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
              <th className="pb-2">Currency</th>
              <th className="pb-2">Rows</th>
              <th className="pb-2">Date span</th>
              <th className="pb-2">Rate</th>
              <th className="pb-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const entry = state.entries[row.currency];
              if (!entry) return null;
              const dates = Object.keys(entry.ecbRatesByDate).sort();
              const rateValues = dates.map((d) => entry.ecbRatesByDate[d]);
              const rangeLabel =
                rateValues.length === 0
                  ? "unresolved"
                  : rateValues.length === 1 || new Set(rateValues).size === 1
                    ? rateValues[0].toFixed(5)
                    : `${Math.min(...rateValues).toFixed(5)} – ${Math.max(...rateValues).toFixed(5)}`;
              return (
                <tr key={row.currency} className="border-t border-[var(--color-border)]">
                  <td className="py-2 font-medium">{row.currency}</td>
                  <td className="py-2">{row.rowCount}</td>
                  <td className="py-2">{row.dateSpan.from} – {row.dateSpan.to}</td>
                  <td className="py-2">
                    {entry.mode === "manual" ? (
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        required
                        value={entry.manualRate}
                        onChange={(e) => dispatch({ type: "setManualRate", currency: row.currency, value: e.target.value })}
                        placeholder="Rate"
                      />
                    ) : (
                      rangeLabel
                    )}
                  </td>
                  <td className="py-2">
                    <Select
                      value={entry.mode}
                      onChange={(e) => dispatch({ type: "setMode", currency: row.currency, mode: e.target.value as "ecb" | "manual" })}
                    >
                      <option value="ecb">ECB per order date</option>
                      <option value="manual">Manual</option>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </form>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
        <Button type="submit" form="fx-rate-review-form" disabled={confirming || !complete}>
          {confirming ? "Applying rates…" : "Confirm rates & import"}
        </Button>
      </div>
    </div>
  );
}
