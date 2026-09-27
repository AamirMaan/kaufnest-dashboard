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

  it("suggests no currency when both neighbours repeat the total in different currencies", () => {
    const text = ["20.00 USD", "Total: 20.00", "20.00 EUR"].join("\n");
    const parsed = parse(text);
    expect(parsed.amount).toBe(20);
    expect(parsed.currency).toBeUndefined();
  });

  // ─── Final-review fixes ─────────────────────────────────────────────────

  it("recognises Brutto as the grand total (German gross-total label)", () => {
    const text = ["Netto 100,00", "MwSt 19% 19,00", "Brutto 119,00", "Bar 150,00", "Rückgeld 31,00"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 119, vatRate: 19 });
  });

  it("recognises Brutto over a non-amount line containing a date-like number", () => {
    const text = ["Rechnung 2026.09", "Artikel 12,00", "Brutto 12,00"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 12 });
  });

  it("does not treat a column-header line as the total, and recognises Endsumme", () => {
    const text = ["Pos Menge Einzelpreis Summe", "1 2 50,00 100,00", "Endsumme 119,00 €"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 119, currency: "EUR" });
  });

  it("does not read a qty/price row '1 100,00 100,00' as 1100 (ambiguous → left empty)", () => {
    const text = ["Gesamt", "1 100,00 100,00"].join("\n");
    expect(parse(text).amount).toBeUndefined();
  });

  it("does not let 'Total savings' beat the real Total", () => {
    const text = ["TESCO", "Total savings £4.50", "Total £3.20", "Cash £5.00", "Change £1.80"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 3.2, currency: "GBP" });
  });

  it("skips the buyer's own VAT ID (Ihre USt-IdNr.) in favour of the vendor's", () => {
    const text = [
      "Lieferant GmbH",
      "USt-IdNr.: DE222222222",
      "Ihre USt-IdNr.: DE111111111",
      "Gesamtbetrag 100,00 €",
    ].join("\n");
    expect(parse(text).vendorVatNumber).toBe("DE222222222");
  });

  it("skips the buyer's own VAT ID even when it appears first", () => {
    const text = [
      "Lieferant GmbH",
      "Ihre USt-IdNr.: DE111111111",
      "USt-IdNr.: DE222222222",
      "Gesamtbetrag 100,00 €",
    ].join("\n");
    expect(parse(text).vendorVatNumber).toBe("DE222222222");
  });

  it("does not mistake a weight unit ('kg') or an amount-bearing line for the vendor", () => {
    const text = ["ALDI SÜD", "Bananen 1,2 kg 2,39", "Summe 2,39 €"].join("\n");
    expect(parse(text).vendor).toBe("ALDI SÜD");
  });

  it("does not take the recipient ('An:') line as the vendor", () => {
    const text = ["An: Kaufnest GmbH", "Musterstraße 1", "Rechnung", "Gesamtbetrag 10,00 €"].join("\n");
    expect(parse(text).vendor).toBeUndefined();
  });

  it("prefers a credit note's own number over the original invoice it references", () => {
    const text = ["Gutschrift Nr. GS-12", "zur Rechnung Nr. RE-99", "Gesamtbetrag -20,00 €"].join("\n");
    expect(parse(text)).toMatchObject({ invoiceNumber: "GS-12", amount: -20 });
  });

  // ─── Targeted fix (round 2 re-review regressions) ────────────────────────

  it("reads a total on the next line after a multi-word label", () => {
    expect(parse(["Item 1 15,00", "Item 2 200,00", "Total due", "50,00"].join("\n")).amount).toBe(50);
    expect(parse(["Subtotal items 300,00", "Total amount payable", "50,00"].join("\n")).amount).toBe(50);
  });

  it("keeps the sign on a space-grouped negative total (credit note)", () => {
    expect(parse("Gesamtbetrag -1 234,56 €").amount).toBe(-1234.56);
  });

  it("does not treat 'Exchange' as a change-given line", () => {
    expect(parse("Exchange rate total 12,00 €").amount).toBe(12);
  });

  it("reads a space-grouped four-digit total", () => {
    expect(parse("Gesamtbetrag 1 234,56 €")).toMatchObject({ amount: 1234.56, currency: "EUR" });
  });

  it("does not merge a quantity into an item price", () => {
    expect(parse(["Anzahl 2 125,00", "Summe 125,00"].join("\n")).amount).toBe(125);
  });

  it("treats a cash-paid total as the total", () => {
    expect(parse(["Artikel A 5,00", "Artikel B 99,00", "Summe bar 12,00"].join("\n")).amount).toBe(12);
    expect(parse(["Subtotal 10,00", "Discount -6,80", "Total paid by cash 3,20"].join("\n")).amount).toBe(3.2);
  });

  it("leaves the amount empty when no total line is recognised", () => {
    expect(parse(["Artikel 5,00", "Artikel 99,00"].join("\n")).amount).toBeUndefined();
  });

  it("keeps a vendor whose name starts with To or An", () => {
    expect(parse(["To Fresh Bakery Ltd", "Some street 1", "Berlin", "Gesamtbetrag 10,00 €"].join("\n")).vendor).toBe("To Fresh Bakery Ltd");
    expect(parse(["An Konditorei GmbH", "Hauptstr 1", "München", "Gesamtbetrag 10,00 €"].join("\n")).vendor).toBe("An Konditorei GmbH");
  });
});
