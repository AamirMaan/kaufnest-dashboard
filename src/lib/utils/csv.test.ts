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

describe("parseCsvText — newlines inside quoted fields", () => {
  it("keeps a quoted field's line break as ONE row", () => {
    // Real row from a German Amazon VAT ledger: the description wraps.
    const csv =
      "date,description,amount\n" +
      '31.05.2026,"Contribuciones ecológicas y tarifas de\nservicio de RAP",30.42';
    const { rows } = parseCsvText(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe(
      "Contribuciones ecológicas y tarifas de\nservicio de RAP",
    );
    expect(rows[0].amount).toBe("30.42");
  });

  it("still splits ordinary rows", () => {
    const { rows } = parseCsvText("a,b\n1,2\n3,4");
    expect(rows).toHaveLength(2);
    expect(rows[1].a).toBe("3");
  });

  it("handles an escaped double quote inside a quoted field", () => {
    const csv = 'a,b\n"Gebühren ""Versand durch Amazon""",5';
    const { rows } = parseCsvText(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBe('Gebühren "Versand durch Amazon"');
  });

  it("still drops blank lines", () => {
    const { rows } = parseCsvText("a,b\n1,2\n\n\n3,4");
    expect(rows).toHaveLength(2);
  });

  it("a stray unterminated quote merges the remaining rows (accepted trade-off of multi-line support)", () => {
    // Once a quote opens without a matching close, inQuotes never flips back
    // off, so every following newline — including ones between otherwise
    // well-formed rows — is absorbed into the same field. This is the
    // unavoidable cost of correctly supporting multi-line quoted fields
    // (see the doc comment on splitRows), not a bug to "fix" with recovery
    // heuristics.
    const { rows } = parseCsvText('a,b\n"unterminated,1\n2,3');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ a: "unterminated,1\n2,3", b: "" });
  });
});
