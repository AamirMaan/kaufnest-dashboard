export interface CurrencyReviewEntry {
  currency: string;
  mode: "ecb" | "manual";
  /** Per-row-date ECB rates already resolved, keyed by ISO date. Empty until fetched. */
  ecbRatesByDate: Record<string, number>;
  /** The rate-review UI's manual-mode input, as a string (so an empty/invalid
   *  input can be represented without coercing to 0 or NaN). */
  manualRate: string;
  /** True if the API reported this currency as fully unresolved by ECB — the
   *  entry then STARTS in manual mode with an empty required input. */
  startedUnresolved: boolean;
}

export interface FxReviewState {
  entries: Record<string, CurrencyReviewEntry>; // keyed by currency code
}

export type FxReviewAction =
  | { type: "init"; currencies: string[]; unresolvedCurrencies: string[] }
  | { type: "ratesResolved"; rates: Record<string, { rate: number; rateDate: string }> }
  | { type: "setMode"; currency: string; mode: "ecb" | "manual" }
  | { type: "setManualRate"; currency: string; value: string };

export function fxReviewReducer(state: FxReviewState, action: FxReviewAction): FxReviewState {
  switch (action.type) {
    case "init": {
      const entries: Record<string, CurrencyReviewEntry> = {};
      for (const currency of action.currencies) {
        const startedUnresolved = action.unresolvedCurrencies.includes(currency);
        entries[currency] = {
          currency,
          mode: startedUnresolved ? "manual" : "ecb",
          ecbRatesByDate: {},
          manualRate: "",
          startedUnresolved,
        };
      }
      return { entries };
    }
    case "ratesResolved": {
      const entries = { ...state.entries };
      for (const [key, { rate, rateDate }] of Object.entries(action.rates)) {
        const [currency] = key.split(":");
        const entry = entries[currency];
        if (!entry) continue;
        entries[currency] = {
          ...entry,
          ecbRatesByDate: { ...entry.ecbRatesByDate, [rateDate]: rate },
        };
      }
      return { entries };
    }
    case "setMode": {
      const entry = state.entries[action.currency];
      if (!entry) return state;
      return { entries: { ...state.entries, [action.currency]: { ...entry, mode: action.mode } } };
    }
    case "setManualRate": {
      const entry = state.entries[action.currency];
      if (!entry) return state;
      return {
        entries: { ...state.entries, [action.currency]: { ...entry, manualRate: action.value } },
      };
    }
    default:
      return state;
  }
}

/**
 * Whether every currency in the review has a usable rate — the confirm
 * button's disabled condition. Manual mode needs a positive numeric input;
 * ECB mode needs at least one resolved rate for that currency (a specific
 * row's exact date might still miss and fall back to the nearest available
 * date within the entry's ecbRatesByDate — resolveRowRate handles that).
 */
export function isReviewComplete(state: FxReviewState): boolean {
  return Object.values(state.entries).every((entry) => {
    if (entry.mode === "manual") {
      const parsed = Number(entry.manualRate);
      return entry.manualRate.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
    }
    return Object.keys(entry.ecbRatesByDate).length > 0;
  });
}

/**
 * Resolves the final rate + rate date for one row, once the review is
 * confirmed. Manual mode applies the same typed rate to every row of that
 * currency, with today's date as the "rate date" (there is no per-row ECB
 * date in manual mode — the user's typed figure IS the rate, undated).
 * ECB mode looks up the row's own date in ecbRatesByDate; if that exact
 * date is missing (shouldn't happen if `init`/`ratesResolved` covered every
 * date in the file, but defensive), falls back to the first available
 * date for that currency rather than throwing.
 */
export function resolveRowRate(
  rowCurrency: string,
  rowDate: string,
  state: FxReviewState
): { rate: number; rateDate: string } | null {
  const entry = state.entries[rowCurrency];
  if (!entry) return null;
  if (entry.mode === "manual") {
    const parsed = Number(entry.manualRate);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return { rate: parsed, rateDate: rowDate };
  }
  if (entry.ecbRatesByDate[rowDate] !== undefined) {
    return { rate: entry.ecbRatesByDate[rowDate], rateDate: rowDate };
  }
  const fallbackDate = Object.keys(entry.ecbRatesByDate)[0];
  if (fallbackDate === undefined) return null;
  return { rate: entry.ecbRatesByDate[fallbackDate], rateDate: fallbackDate };
}
