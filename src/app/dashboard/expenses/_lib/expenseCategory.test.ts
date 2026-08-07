import { categoryFor } from "./expenseCategory";

describe("categoryFor", () => {
  it("maps advertising", () => {
    expect(categoryFor("Ads")).toBe("advertising");
    expect(categoryFor("Werbung")).toBe("advertising");
  });

  it("maps Amazon fulfilment fees across all six marketplace languages", () => {
    // Amazon localises the SAME fee per marketplace — these all appear in one
    // quarterly ledger.
    expect(categoryFor('Gebühren im Zusammenhang mit "Versand durch Amazon"')).toBe("shipping");
    expect(categoryFor("Fulfilment by Amazon Fees")).toBe("shipping");
    expect(categoryFor("Kosten voor Fulfillment by Amazon")).toBe("shipping");
    expect(categoryFor("Commissioni di Logistica di Amazon")).toBe("shipping");
    expect(categoryFor("Tarifas de logística de Amazon")).toBe("shipping");
    expect(categoryFor("Avgifter för Fraktas från Amazon")).toBe("shipping");
    expect(categoryFor("Frais d'expédition par Amazon")).toBe("shipping");
  });

  it("maps software subscriptions", () => {
    expect(categoryFor("sellerboard subscription (standard plan)")).toBe("software");
  });

  it("maps office supplies", () => {
    expect(categoryFor("Office Supply")).toBe("office");
    expect(categoryFor("Kitchen towel")).toBe("office");
  });

  it("maps eco-contribution levies to tax", () => {
    expect(categoryFor("EPR Pay on Behalf eco-contributions and service fees")).toBe("tax");
    expect(categoryFor("Contribuciones ecológicas y tarifas de servicio de RAP")).toBe("tax");
  });

  it("is case-insensitive", () => {
    expect(categoryFor("ADS")).toBe("advertising");
    expect(categoryFor("benzin")).toBe(categoryFor("Benzin"));
  });

  it("falls back to other for selling fees, fuel and leasing", () => {
    // Selling/commission fees have no fitting category in ExpenseCategory —
    // a `fees` value is a documented follow-up, deliberately out of scope.
    expect(categoryFor("Gebühren für Verkaufen bei Amazon")).toBe("other");
    expect(categoryFor("Benzin")).toBe("other");
    expect(categoryFor("Car leasing")).toBe("other");
  });

  it("falls back to other for blank or unknown input", () => {
    expect(categoryFor(undefined)).toBe("other");
    expect(categoryFor("")).toBe("other");
    expect(categoryFor("Something nobody mapped")).toBe("other");
  });

  it("matches real ledger entries using word boundaries", () => {
    // Real rows from the quarterly ledger
    expect(categoryFor("DCP Container Packing")).toBe("shipping");
    expect(categoryFor("Logistik provider")).toBe("shipping");
  });

  it("does not mistake 'wrap' for the RAP eco-levy", () => {
    // Shrink wrap and bubble wrap are ordinary packaging lines for e-commerce.
    // Without word boundaries, "rap" in "wrap" would incorrectly match as tax.
    expect(categoryFor("Shrink wrap for shipping boxes")).toBe("shipping");
  });

  it("does not mistake 'ads' in 'downloads'", () => {
    // Without word boundaries, "ads" would incorrectly match in "downloads".
    expect(categoryFor("E-book downloads")).toBe("other");
  });

  it("does not mistake payroll for eco-contribution tax", () => {
    // Spanish payroll entry. Without checking word boundaries and removing
    // "contribuciones" from the keywords, this would incorrectly land in tax.
    expect(categoryFor("Contribuciones a la Seguridad Social")).toBe("other");
  });
});
