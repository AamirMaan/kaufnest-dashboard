/**
 * Locale-tolerant parsing helpers for CSV import (German + English inputs).
 * Pure functions — no Supabase/Redux/DOM deps — so they're unit-testable.
 * See `src/app/dashboard/sales/CLAUDE.md` → "CSV import/export".
 */

/**
 * Parse a number that may use German ("1.234,56") or English ("1,234.56")
 * conventions, optionally decorated with a currency symbol or spaces.
 *
 * Rules:
 * - both "." and "," present → the LAST of the two is the decimal separator
 * - only "," present → decimal comma ("9,99" → 9.99)
 * - only "." present → thousands separator ONLY for the exact pattern
 *   `\d{1,3}(\.\d{3})+` ("1.234" → 1234), otherwise decimal ("9.99" → 9.99)
 *
 * Returns `null` for blank/unparseable input — callers must treat `null`
 * on a required field as a row error, never as 0.
 */
export function parseLocaleNumber(input: string | undefined): number | null {
  if (input == null) return null;
  // Strip currency symbols, regular/non-breaking/narrow spaces.
  const s = input.replace(/[€$£]/g, "").replace(/[\s  ]/g, "").trim();
  if (s === "") return null;
  if (!/^[+-]?[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // German: "." thousands, "," decimal
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      // English: "," thousands, "." decimal
      normalized = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // Only commas. Single comma → decimal. Multiple commas → thousands only
    // if the grouping pattern is exact ("1,234,567"), else unparseable.
    const commaCount = s.split(",").length - 1;
    if (commaCount === 1) {
      normalized = s.replace(",", ".");
    } else if (/^[+-]?\d{1,3}(,\d{3})+$/.test(s)) {
      normalized = s.replace(/,/g, "");
    } else {
      return null;
    }
  } else if (lastDot !== -1) {
    // Only dots. German thousands only for the exact grouping pattern.
    if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) {
      normalized = s.replace(/\./g, "");
    } else if (s.split(".").length - 1 === 1) {
      normalized = s; // plain decimal point
    } else {
      return null; // e.g. "1.23.45"
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DE_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

export type DateOrder = "dmy" | "mdy";

export interface DateOrderDetection {
  /** The order to parse with. Always usable — falls back to "dmy" when undecidable. */
  order: DateOrder;
  /** True when the file contained hard evidence for this order. */
  confident: boolean;
  /** Present ONLY when the file contains evidence for BOTH orders. Refuse the import. */
  conflict?: { dayFirstSample: string; monthFirstSample: string };
}

// Matching separators only: "10-04/2026" is malformed, not evidence.
// Dot-separated dates are deliberately excluded — DD.MM.YYYY is the German
// convention and MM.DD.YYYY does not occur, so they carry no evidence.
const SEPARATED_DATE = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/;

/**
 * Decide whether a file's dates are day-first or month-first from evidence
 * rather than assumption. `10-04-2026` is genuinely ambiguous; `30-04-2026`
 * is not, because 30 cannot be a month.
 *
 * Silently guessing is what mis-dated 145 live orders — see the spec.
 */
export function detectDateOrder(values: string[]): DateOrderDetection {
  let dayFirstSample: string | undefined;
  let monthFirstSample: string | undefined;

  for (const raw of values) {
    const s = raw?.trim();
    if (!s) continue;
    const m = SEPARATED_DATE.exec(s);
    if (!m) continue; // ISO, dot-separated or malformed — no evidence either way
    const first = Number(m[1]);
    const second = Number(m[3]);
    if (first > 12 && second <= 12) dayFirstSample ??= s;
    else if (second > 12 && first <= 12) monthFirstSample ??= s;
  }

  if (dayFirstSample && monthFirstSample) {
    return { order: "dmy", confident: false, conflict: { dayFirstSample, monthFirstSample } };
  }
  if (dayFirstSample) return { order: "dmy", confident: true };
  if (monthFirstSample) return { order: "mdy", confident: true };
  return { order: "dmy", confident: false };
}

/**
 * Parse a date that is either ISO ("2024-01-15") or German/European
 * DD-first format ("15.01.2024", "26-03-2026", "26/03/2026") and return
 * ISO `YYYY-MM-DD`. Accepts `.`, `/`, or `-` as separators.
 * Validates real calendar dates. Two-digit years are rejected → returns `null`.
 *
 * The `order` parameter defaults to "dmy" (day-first) but can be set to "mdy"
 * (month-first) for regions that use MM-DD-YYYY format. Note that dot-separated
 * dates (e.g., "15.01.2024") are always parsed as DD.MM.YYYY regardless of the
 * order parameter, as this is the German convention.
 */
export function parseFlexibleDate(input: string | undefined, order: DateOrder = "dmy"): string | null {
  const s = input?.trim();
  if (!s) return null;

  let year: number, month: number, day: number;
  const iso = ISO_DATE.exec(s);
  const de = iso ? null : DE_DATE.exec(s);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (de) {
    const first = Number(de[1]);
    const second = Number(de[2]);
    year = Number(de[3]);
    // A dot-separated date is always day-first: DD.MM.YYYY is the German
    // convention and MM.DD.YYYY does not occur, so `order` must not flip it.
    if (order === "mdy" && !s.includes(".")) {
      month = first; day = second;
    } else {
      day = first; month = second;
    }
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Real-calendar check (no 31.02.): Date months are 0-based; overflow rolls over.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
