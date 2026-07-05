import { detectDelimiter, parseCsvText } from "./csv";

describe("detectDelimiter", () => {
  it("comma header → ','", () => {
    expect(detectDelimiter("date,product_name,quantity")).toBe(",");
  });

  it("semicolon header (German Excel) → ';'", () => {
    expect(detectDelimiter("Datum;Artikelname;Menge")).toBe(";");
  });

  it("tab header → '\\t'", () => {
    expect(detectDelimiter("date\tproduct\tqty")).toBe("\t");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"a;b;c;d",x,y')).toBe(",");
  });

  it("tie → comma", () => {
    expect(detectDelimiter("plain")).toBe(",");
  });
});

describe("parseCsvText", () => {
  it("parses comma-delimited CSV (existing behavior)", () => {
    const { headers, rows } = parseCsvText("a,b\n1,2\n3,4");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("parses semicolon-delimited CSV", () => {
    const { headers, rows } = parseCsvText("Datum;Menge\n15.01.2024;2");
    expect(headers).toEqual(["datum", "menge"]);
    expect(rows).toEqual([{ datum: "15.01.2024", menge: "2" }]);
  });

  it("strips a leading UTF-8 BOM", () => {
    const { headers } = parseCsvText("﻿date,qty\n2024-01-01,1");
    expect(headers).toEqual(["date", "qty"]);
  });

  it("handles quoted fields containing the delimiter", () => {
    const { rows } = parseCsvText('name;note\n"Widget; large";"a;b"');
    expect(rows).toEqual([{ name: "Widget; large", note: "a;b" }]);
  });

  it("semicolon file with decimal commas keeps values intact", () => {
    const { rows } = parseCsvText("preis;menge\n9,99;2");
    expect(rows).toEqual([{ preis: "9,99", menge: "2" }]);
  });

  it("empty / header-only input → empty result", () => {
    expect(parseCsvText("")).toEqual({ headers: [], rows: [] });
    expect(parseCsvText("a,b")).toEqual({ headers: [], rows: [] });
  });
});
