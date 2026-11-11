import type { Currency } from "@/types";

/**
 * Converts a base-currency-agnostic amount using a given rate, half-up
 * rounded to 2 decimal places (not banker's rounding — a tax-relevant
 * figure should round consistently in the direction a human expects).
 */
export function convertAmount(amount: number, rate: number): number {
  if (!(rate > 0)) {
    throw new Error(`convertAmount: rate must be positive, got ${rate}`);
  }
  const converted = amount * rate;
  // Half-up rounding: Math.round rounds .5 away from zero for positive
  // numbers, but toward zero is wrong for negatives — handle sign explicitly.
  const sign = converted < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(converted) * 100)) / 100;
}

const ISO_CODE_RE = /^[A-Z]{3}$/;

/**
 * Whether a (trimmed, uppercased) string has a plausible ISO-4217 shape —
 * 3 letters. Not a real currency-code lookup, just shape validation; the
 * canonical definition shared with `classifySkip`'s currency guard in
 * `importFormats.ts`/`expenseImportFormats.ts` so the two never drift.
 */
export function isPlausibleIsoCode(code: string): boolean {
  return ISO_CODE_RE.test(code);
}

/**
 * Decides whether a sheet's raw currency value needs conversion.
 * - Blank/undefined -> treated as the base currency (no conversion).
 * - Matches the base currency (case-insensitive) -> no conversion.
 * - A plausible ISO-4217 shape different from the base currency -> needs
 *   conversion, `sheetCurrency` set to the normalized code.
 * - Anything else (not 3 letters) -> an error, same "unsupported currency"
 *   wording classifySkip already uses, so the two stay consistent.
 */
export function resolveSheetCurrency(
  raw: string | undefined,
  baseCurrency: Currency
): { currency: Currency; sheetCurrency: string | null } | { error: string } {
  const trimmed = raw?.trim().toUpperCase();
  if (!trimmed || trimmed === baseCurrency) {
    return { currency: baseCurrency, sheetCurrency: null };
  }
  if (!isPlausibleIsoCode(trimmed)) {
    return { error: `unsupported currency "${raw}"` };
  }
  return { currency: baseCurrency, sheetCurrency: trimmed };
}

/**
 * Money fields besides total_amount/vat_amount that a row MAY carry. Every
 * one present as a number is converted too. Before 2026-11-11 only
 * total_amount/vat_amount were, so a converted SEK sale kept its
 * `shipping_charged` (and `unit_price`) in kronor — 49.00 SEK of shipping was
 * summed into revenue as €49.00 (k2_textil, May–July 2026).
 */
const EXTRA_MONEY_FIELDS = [
  "unit_price",
  "shipping_charged",
  "shipping_cost",
  "advertising_fee",
  "platform_fee",
] as const;

/**
 * Applies a confirmed FX rate to one parsed row's money fields, returning a
 * NEW object (never mutates the input) with total_amount/vat_amount — and
 * any of EXTRA_MONEY_FIELDS the row carries as a number — converted to base
 * currency, and the original figures recorded for audit.
 */
export function applyRate<T extends { total_amount: number; vat_amount: number | null }>(
  row: T,
  sheetCurrency: string,
  rate: number,
  rateDate: string
): T & {
  original_currency: string;
  original_total_amount: number;
  fx_rate: number;
  fx_rate_date: string;
} {
  const extras: Record<string, number> = {};
  const fields = row as unknown as Record<string, unknown>;
  for (const key of EXTRA_MONEY_FIELDS) {
    const value = fields[key];
    if (typeof value === "number") extras[key] = convertAmount(value, rate);
  }
  return {
    ...row,
    ...extras,
    total_amount: convertAmount(row.total_amount, rate),
    vat_amount: row.vat_amount === null ? null : convertAmount(row.vat_amount, rate),
    original_currency: sheetCurrency,
    original_total_amount: row.total_amount,
    fx_rate: rate,
    fx_rate_date: rateDate,
  };
}

/**
 * True while any importable row still needs its FX rate applied — i.e. it
 * carries a `sheetCurrency` but `applyRate` hasn't stamped
 * `original_currency` on its data yet. Import buttons gate on this.
 *
 * Derived from the rows themselves rather than from "is the review step
 * open" UI state, because that state only flips once the `/api/fx/rates`
 * fetch resolves. In the window before it, the Import button was live and
 * an import inserted SEK amounts as if they were EUR (k2_textil Aug/Sep
 * 2026, ~€12k overstated).
 */
export function hasPendingFxConversion(
  rows: ReadonlyArray<{
    sheetCurrency?: string | null;
    skipped?: string | null;
    error?: string | null;
    data: { original_currency?: string | null } | null;
  }>,
): boolean {
  return rows.some(
    (r) => !!r.sheetCurrency && !r.skipped && !r.error && !!r.data && !r.data.original_currency,
  );
}
