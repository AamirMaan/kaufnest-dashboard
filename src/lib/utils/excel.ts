/**
 * Excel import utility for the Sales import modal.
 *
 * Returns the same `{ headers, rows }` shape as `parseCsvText` so the
 * existing `resolveHeaders` / `canonicalizeRow` / `validateRowForFormat`
 * pipeline works unchanged for both file types.
 *
 * Pure module (no React/Supabase/Redux) — tested in `excel.test.ts`.
 */

import * as XLSX from "xlsx";
import { looksLikeDate } from "./localeParse";

export interface ExcelParseResult {
  headers: string[];
  rows: Record<string, string>[];
  /**
   * Headers whose column mixes a native Excel date-typed cell with a
   * plain-text, date-shaped cell.
   *
   * Excel only auto-converts a typed/pasted value into a real date cell when
   * it forms a VALID date under Excel's own locale — "31-05-2026" fails as
   * month=31 under a month-first locale and survives as text, while
   * "03-05-2026" is a valid month=03/day=05 reading under that same locale
   * and gets silently converted, permanently losing the intended day-first
   * meaning (May 3rd becomes March 5th). The corrupted cell never becomes
   * text, so it never reaches `detectDateOrder`/`parseFlexibleDate` —
   * unlike a plain CSV, where the same ambiguous string stays text and
   * those functions can evaluate it. This mix is the only signature our
   * code can see; the original text is gone by the time we read the file.
   * Callers should refuse the import when a resolved `date` column is
   * flagged here, the same way a `detectDateOrder` conflict is refused.
   */
  mixedDateTypeColumns: Set<string>;
}

/** Convert a raw SheetJS cell value to a plain string for the import pipeline. */
function cellToString(val: unknown): string {
  if (val == null) return "";
  if (val instanceof Date) {
    // Format as YYYY-MM-DD — parseFlexibleDate handles this format.
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "number") {
    // Use JS number-to-string (decimal point, no grouping) so parseLocaleNumber
    // parses it cleanly without needing to strip thousands separators.
    return String(val);
  }
  return String(val).trim();
}

/**
 * Parse an Excel file (`.xlsx` or `.xls`) from an ArrayBuffer into the same
 * shape that `parseCsvText` produces.
 *
 * - Uses the first worksheet only.
 * - Headers are lowercased and trimmed (same as `parseCsvText`).
 * - Entirely blank rows are dropped.
 */
export function parseExcelBuffer(buffer: ArrayBuffer): ExcelParseResult {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [], mixedDateTypeColumns: new Set() };

  const sheet = workbook.Sheets[sheetName];
  // `header: 1` → array-of-arrays; `raw: true` → unformatted values so we
  // control stringification; `cellDates: true` already applied at read time.
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });

  if (data.length === 0) return { headers: [], rows: [], mixedDateTypeColumns: new Set() };

  const headers = (data[0] as unknown[]).map((h) =>
    String(h ?? "").toLowerCase().trim(),
  );

  if (data.length < 2) return { headers, rows: [], mixedDateTypeColumns: new Set() };

  const dataRows = data.slice(1) as unknown[][];

  // Per column: did any cell arrive as a native date type, and did any OTHER
  // cell arrive as date-shaped text? Computed on the raw (pre-cellToString)
  // values, over every data row — including ones later dropped as blank —
  // since the mix itself is what's diagnostic, not which rows survive.
  const hasDateCell = new Array(headers.length).fill(false);
  const hasDateTextCell = new Array(headers.length).fill(false);
  for (const arr of dataRows) {
    for (let i = 0; i < headers.length; i++) {
      const v = arr[i];
      if (v instanceof Date) hasDateCell[i] = true;
      else if (typeof v === "string" && looksLikeDate(v)) hasDateTextCell[i] = true;
    }
  }
  const mixedDateTypeColumns = new Set(
    headers.filter((h, i) => hasDateCell[i] && hasDateTextCell[i]),
  );

  const rows = dataRows
    .map((arr) =>
      Object.fromEntries(headers.map((h, i) => [h, cellToString(arr[i])])),
    )
    // Drop rows where every cell is blank (trailing empty rows in Excel files).
    .filter((row) => Object.values(row).some((v) => v !== ""));

  return { headers, rows, mixedDateTypeColumns };
}
