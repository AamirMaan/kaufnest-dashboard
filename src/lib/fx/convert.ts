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
  if (!ISO_CODE_RE.test(trimmed)) {
    return { error: `unsupported currency "${raw}"` };
  }
  return { currency: baseCurrency, sheetCurrency: trimmed };
}

/**
 * Applies a confirmed FX rate to one parsed row's money fields, returning a
 * NEW object (never mutates the input) with total_amount/vat_amount
 * converted to base currency and the original figures recorded for audit.
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
  return {
    ...row,
    total_amount: convertAmount(row.total_amount, rate),
    vat_amount: row.vat_amount === null ? null : convertAmount(row.vat_amount, rate),
    original_currency: sheetCurrency,
    original_total_amount: row.total_amount,
    fx_rate: rate,
    fx_rate_date: rateDate,
  };
}
