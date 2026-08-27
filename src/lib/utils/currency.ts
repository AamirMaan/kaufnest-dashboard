import type { Currency } from "@/types";

/**
 * Format a number as a German-locale currency string.
 * e.g. formatCurrency(1234.5, "EUR") → "1.234,50 €"
 */
export function formatCurrency(amount: number, currency: Currency = "EUR"): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Calculate net profit: revenue - expenses - purchases.
 */
export function calculateNetProfit(
  revenue: number,
  expenses: number,
  purchases: number
): number {
  return revenue - expenses - purchases;
}

/**
 * Sum an array of amounts, rounding to 2 decimal places.
 */
export function sumAmounts(amounts: number[]): number {
  const total = amounts.reduce((acc, v) => acc + v, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Calculate margin percentage.
 * Returns null if revenue is 0 to avoid division by zero.
 */
export function calculateMargin(revenue: number, cost: number): number | null {
  if (revenue === 0) return null;
  return Math.round(((revenue - cost) / revenue) * 10000) / 100; // 2 decimal %
}

/**
 * Extract the VAT portion from a VAT-inclusive gross total.
 * e.g. vatAmountFromGross(119, 19) → 19 (net would be 100)
 * Returns 0 when the rate is 0 or negative.
 */
export function vatAmountFromGross(gross: number, ratePercent: number): number {
  if (ratePercent <= 0) return 0;
  const vat = (gross * ratePercent) / (100 + ratePercent);
  return Math.round(vat * 100) / 100;
}

/**
 * Compute a fee amount from a percentage of a base figure — e.g. an
 * advertising or platform fee entered as "12%" of the order's item total.
 * Returns 0 when the percentage is 0 or negative.
 */
export function computeFeeFromPercent(base: number, percent: number): number {
  if (percent <= 0) return 0;
  return Math.round(base * percent) / 100;
}
