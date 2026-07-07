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
});
