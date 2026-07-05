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
const DE_DATE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;

/**
 * Parse a date that is either ISO ("2024-01-15") or German
 * ("15.01.2024", "1.2.2024", also "/" as separator) and return ISO
 * `YYYY-MM-DD`. Validates real calendar dates. Two-digit years are
 * rejected (too ambiguous) → returns `null`.
 */
export function parseFlexibleDate(input: string | undefined): string | null {
  const s = input?.trim();
  if (!s) return null;

  let year: number, month: number, day: number;
  const iso = ISO_DATE.exec(s);
  const de = iso ? null : DE_DATE.exec(s);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (de) {
    day = Number(de[1]); month = Number(de[2]); year = Number(de[3]);
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
