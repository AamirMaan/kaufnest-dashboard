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
export function parseExcelBuffer(
  buffer: ArrayBuffer,
): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  // `header: 1` → array-of-arrays; `raw: true` → unformatted values so we
  // control stringification; `cellDates: true` already applied at read time.
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });

  if (data.length === 0) return { headers: [], rows: [] };

  const headers = (data[0] as unknown[]).map((h) =>
    String(h ?? "").toLowerCase().trim(),
  );

  if (data.length < 2) return { headers, rows: [] };

  const rows = (data.slice(1) as unknown[][])
    .map((arr) =>
      Object.fromEntries(headers.map((h, i) => [h, cellToString(arr[i])])),
    )
    // Drop rows where every cell is blank (trailing empty rows in Excel files).
    .filter((row) => Object.values(row).some((v) => v !== ""));

  return { headers, rows };
}
