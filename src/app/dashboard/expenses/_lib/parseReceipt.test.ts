import { parseReceipt, toNumber } from "./parseReceipt";

const TODAY = "2026-09-27";
const parse = (text: string) => parseReceipt(text, { today: TODAY });

describe("toNumber", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1234,56", 1234.56],
    ["-12.00", -12],
    ["1 234,56", 1234.56],
  ])("%s → %d", (raw, expected) => {
    expect(toNumber(raw)).toBe(expected);
  });
});

describe("parseReceipt", () => {
  it("reads a German invoice (Rechnung)", () => {
    const text = [
      "Verpackungsprofi GmbH",
      "Industriestraße 12, 10115 Berlin",
      "USt-IdNr.: DE123456789",
      "Rechnung",
      "Rechnungsnummer: RE-2026-0042",
      "Rechnungsdatum: 14.09.2026",
      "Luftpolsterfolie 3 x 12,50 37,50",
      "Zwischensumme 37,50",
      "zzgl. MwSt 19% 7,13",
      "Gesamtbetrag 44,63 €",
      "IBAN DE89 3704 0044 0532 0130 00",
    ].join("\n");
    expect(parse(text)).toEqual({
      date: "2026-09-14",
      amount: 44.63,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 7.13,
      vendorVatNumber: "DE123456789",
      invoiceNumber: "RE-2026-0042",
      vendor: "Verpackungsprofi GmbH",
    });
  });

  it("reads an English invoice with thousands separators", () => {
    const text = [
      "Acme Supplies Ltd",
      "Invoice No: INV-10077",
      "Invoice date: 3 September 2026",
      "VAT No: GB123456789",
      "Subtotal £1,000.00",
      "VAT 20% £200.00",
      "Total due £1,200.00",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      date: "2026-09-03",
      amount: 1200,
      currency: "GBP",
      vatRate: 20,
      vatAmount: 200,
      vendorVatNumber: "GB123456789",
      invoiceNumber: "INV-10077",
      vendor: "Acme Supplies Ltd",
    });
  });

  it("reads a DHL receipt and suggests the shipping category", () => {
    const text = [
      "Deutsche Post DHL",
      "Filiale 123",
      "Datum 02.09.26 14:31",
      "DHL Paket 2kg 6,99",
      "Summe EUR 6,99",
      "enth. MwSt 19% 1,12",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      date: "2026-09-02",
      amount: 6.99,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 1.12,
      category: "shipping",
    });
  });

  it("puts a total on the next line when the label stands alone (PDF columns)", () => {
    const text = ["Muster Shop", "Gesamt", "129,90 EUR", "Datum: 2026-08-30"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 129.9, currency: "EUR", date: "2026-08-30" });
  });

  it("suggests no VAT rate for a supermarket bill with mixed rates", () => {
    const text = [
      "REWE Markt GmbH",
      "Summe EUR 23,47",
      "MwSt A 19% 1,90",
      "MwSt B 7% 1,01",
      "Datum 21.09.2026",
    ].join("\n");
    const parsed = parse(text);
    expect(parsed).toMatchObject({ amount: 23.47, currency: "EUR", date: "2026-09-21" });
    expect(parsed.vatRate).toBeUndefined();
    expect(parsed.vatAmount).toBeUndefined();
  });

  it("derives the VAT rate from the VAT amount when no percentage is printed", () => {
    const text = ["Shop", "Umsatzsteuer 3,19", "Total 19,99 €"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 19.99, vatAmount: 3.19, vatRate: 19 });
  });

  it("keeps a credit note's negative total", () => {
    const text = ["Gutschrift", "Erstattung Verkäufergebühren", "Gesamtbetrag -123,81 EUR"].join("\n");
    expect(parse(text)).toMatchObject({ amount: -123.81, currency: "EUR" });
  });

  it("handles a receipt with no VAT at all", () => {
    const text = ["Kleinunternehmer Max Mustermann", "Betrag 50,00 €", "Gemäß §19 UStG keine Umsatzsteuer"].join("\n");
    const parsed = parse(text);
    expect(parsed).toMatchObject({ amount: 50, currency: "EUR" });
    expect(parsed.vatRate).toBeUndefined();
  });

  it("does not read a date or an IBAN as an amount or VAT number", () => {
    const text = [
      "Datum 12.03.2026",
      "IBAN DE89370400440532013000",
      "Konto DE12 3456 7890 1234",
      "Total 45,00 EUR",
    ].join("\n");
    const parsed = parse(text);
    expect(parsed.amount).toBe(45);
    expect(parsed.date).toBe("2026-03-12");
    expect(parsed.vendorVatNumber).toBeUndefined();
  });

  it("tolerates noisy OCR text", () => {
    const text = [
      "  Bürobedarf  Schmidt  e.K. ",
      "Beleg-Nr. 000481",
      "~~ 12.09.2026  09:14 ~~",
      "Druckerpapier   A4    8,49",
      "Toner           54,90",
      "SUMME    EUR    63,39",
      "MwSt  19,00 %   10,12",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      amount: 63.39,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 10.12,
      invoiceNumber: "000481",
      date: "2026-09-12",
      vendor: "Bürobedarf Schmidt e.K.",
    });
  });

  it("reads a US dollar receipt", () => {
    const text = ["Canva Pty Ltd", "Receipt #2231-7788", "Date: Sep 5, 2026", "Total $14.99 USD"].join("\n");
    expect(parse(text)).toMatchObject({
      amount: 14.99,
      currency: "USD",
      date: "2026-09-05",
      vendor: "Canva Pty Ltd",
      category: "software",
    });
  });

  it("rejects dates in the future", () => {
    const text = ["Lieferdatum 01.01.2030", "Datum 20.09.2026", "Summe 10,00 €"].join("\n");
    expect(parse(text).date).toBe("2026-09-20");
  });

  it("returns an empty object for text with nothing recognisable", () => {
    expect(parse("hello world")).toEqual({ vendor: "hello world" });
    expect(parse("")).toEqual({});
  });

  it("takes a total phrased 'inkl. MwSt' over a larger list price", () => {
    const text = [
      "Webshop Muster GmbH",
      "Regulärer Preis 199,00",
      "Rabatt -50,00",
      "Gesamtbetrag inkl. MwSt 149,00 €",
      "Datum 10.09.2026",
    ].join("\n");
    expect(parse(text)).toMatchObject({ amount: 149, currency: "EUR", date: "2026-09-10" });
  });

  it("takes a total phrased 'incl. VAT' over a larger list price", () => {
    const text = ["List price $259.00", "Total incl. VAT $199.00"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 199, currency: "USD" });
  });

  it("prefers the invoice date over an earlier delivery date", () => {
    const text = ["Bestellbestätigung", "Lieferdatum 01.09.2026", "Rechnungsdatum 05.09.2026", "Gesamtbetrag 25,00 EUR"].join("\n");
    expect(parse(text).date).toBe("2026-09-05");
  });

  it("does not use a delivery or order date as the expense date", () => {
    const text = ["Lieferdatum 01.09.2026", "Bestelldatum 28.08.2026", "Summe 10,00 €"].join("\n");
    expect(parse(text).date).toBeUndefined();
  });

  it("reads Amazon-style PDF text", () => {
    const text = [
      "Amazon EU S.à r.l.",
      "Rechnungsdatum/Lieferdatum 18 September 2026",
      "Rechnungsnummer DE6ABCD12345",
      "USt-IdNr. LU20260743",
      "Zahlbetrag 34,99 €",
      "MwSt. 19% 5,59 €",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      date: "2026-09-18",
      amount: 34.99,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 5.59,
      vendorVatNumber: "LU20260743",
      invoiceNumber: "DE6ABCD12345",
      vendor: "Amazon EU S.à r.l.",
    });
  });

  it("takes the currency printed next to the total when a receipt shows two", () => {
    const text = ["Order total: $120.00 USD", "Charged in EUR: €110.40"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 120, currency: "USD" });
  });

  it("uses the neighbouring line that repeats the total to pick its currency", () => {
    const text = ["Amount charged: 25.00 USD", "Total: 25.00", "Displayed as: 22.50 EUR"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 25, currency: "USD" });
  });

  it("suggests no currency when the lines around the total disagree", () => {
    const text = ["EUR prices shown", "Total: 30.00", "USD equivalent available"].join("\n");
    const parsed = parse(text);
    expect(parsed.amount).toBe(30);
    expect(parsed.currency).toBeUndefined();
  });
});
