import { formatCurrency } from "@/lib/utils/currency";
import type { Currency } from "@/types";

/** One display-only summary tile: a label and one value line per currency. */
export interface SummaryTile {
  label: string;
  lines: string[];
}

const countFormat = new Intl.NumberFormat("de-DE");

/**
 * Money tile with one line per currency (never converted). `null` — i.e.
 * hidden — when there are no rows or every value is exactly 0. A negative
 * total (credit notes) is real and still shows.
 */
export function moneyTile<T extends { currency: Currency }>(
  label: string,
  rows: T[],
  value: (r: T) => number
): SummaryTile | null {
  if (rows.length === 0 || rows.every((r) => value(r) === 0)) return null;
  return { label, lines: rows.map((r) => formatCurrency(value(r), r.currency)) };
}

/** Count tile — always shown, including 0. */
export function countTile(label: string, count: number): SummaryTile {
  return { label, lines: [countFormat.format(count)] };
}

/** Drops hidden (null) tiles, preserving order. */
export function compactTiles(tiles: (SummaryTile | null)[]): SummaryTile[] {
  return tiles.filter((t): t is SummaryTile => t !== null);
}
