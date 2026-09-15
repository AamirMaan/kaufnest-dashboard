import * as XLSX from "xlsx";
import { parseExcelBuffer } from "./excel";

/** Build an in-memory .xlsx buffer from an array-of-arrays (first row = headers). */
function makeBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

describe("parseExcelBuffer", () => {
  it("returns headers lowercased and rows as string maps", () => {
    const buf = makeBuffer([
      ["Date", "Product_Name", "Quantity", "Unit_Price"],
      ["2024-01-15", "Blue Widget", 5, 9.99],
    ]);
    const { headers, rows } = parseExcelBuffer(buf);
    expect(headers).toEqual(["date", "product_name", "quantity", "unit_price"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2024-01-15", product_name: "Blue Widget", quantity: "5", unit_price: "9.99" });
  });

  it("converts date cells to YYYY-MM-DD strings", () => {
    const ws = XLSX.utils.aoa_to_sheet([["date"], [new Date(2024, 0, 15)]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { rows } = parseExcelBuffer(buf);
    expect(rows[0].date).toBe("2024-01-15");
  });

  it("drops entirely blank trailing rows", () => {
    const buf = makeBuffer([
      ["date", "product_name", "quantity", "unit_price"],
      ["2024-01-15", "Widget", 1, 10],
      ["", "", "", ""],
    ]);
    const { rows } = parseExcelBuffer(buf);
    expect(rows).toHaveLength(1);
  });

  it("returns empty result for sheet with fewer than 2 rows", () => {
    const buf = makeBuffer([["date", "product_name"]]);
    const { headers, rows } = parseExcelBuffer(buf);
    expect(headers).toEqual(["date", "product_name"]);
    expect(rows).toHaveLength(0);
  });

  it("returns empty result for empty workbook", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { headers, rows } = parseExcelBuffer(buf);
    expect(headers).toEqual([]);
    expect(rows).toHaveLength(0);
  });

  it("uses first sheet only when multiple sheets exist", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["name"], ["Alice"]]), "First");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["name"], ["Bob"]]), "Second");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { rows } = parseExcelBuffer(buf);
    expect(rows[0].name).toBe("Alice");
  });

  // Real-world bug (k2_textil, 2026-09-15): Excel only auto-converts a
  // typed/pasted value to a native date cell when it forms a VALID date
  // under Excel's own locale. "31-05-2026" fails as month=31 under a
  // month-first locale, so it survives as plain text; "03-05-2026" is a
  // valid month=03/day=05 reading under that same locale, so Excel silently
  // converts it to a real date cell — interpreting it as March 5th instead
  // of the intended May 3rd. The corrupted cell never becomes text, so
  // `detectDateOrder`/`parseFlexibleDate` never get a chance to catch it —
  // by the time our code sees it, it's already a resolved (wrong) JS Date.
  // The only detectable signature is the MIX itself: some cells in the same
  // column are native dates, others are date-shaped text.
  describe("mixedDateTypeColumns", () => {
    it("flags a column mixing a native date cell with a date-shaped text cell", () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["date", "product_name"],
        [new Date(2026, 2, 5), "Silently corrupted (was really 03-05-2026)"],
        ["31-05-2026", "Correct — Excel couldn't convert this one"],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const { mixedDateTypeColumns } = parseExcelBuffer(buf);
      expect(mixedDateTypeColumns.has("date")).toBe(true);
    });

    it("does not flag a column of consistently native date cells", () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["date"],
        [new Date(2026, 4, 1)],
        [new Date(2026, 4, 2)],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const { mixedDateTypeColumns } = parseExcelBuffer(buf);
      expect(mixedDateTypeColumns.size).toBe(0);
    });

    it("does not flag a column of consistently text date cells", () => {
      const buf = makeBuffer([
        ["date"],
        ["01-05-2026"],
        ["31-05-2026"],
      ]);
      const { mixedDateTypeColumns } = parseExcelBuffer(buf);
      expect(mixedDateTypeColumns.size).toBe(0);
    });

    it("does not flag a native date cell mixed with unrelated (non-date-shaped) text", () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["date", "note"],
        [new Date(2026, 4, 1), "n/a"],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const { mixedDateTypeColumns } = parseExcelBuffer(buf);
      expect(mixedDateTypeColumns.size).toBe(0);
    });
  });
});
