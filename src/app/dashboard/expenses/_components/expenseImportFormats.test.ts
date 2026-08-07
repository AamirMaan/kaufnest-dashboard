import {
  EXPENSE_IMPORT_FORMATS,
  classifySkip,
  validateExpenseRow,
} from "./expenseImportFormats";

// A real row from the Q2-2026 Vorsteuerkonto.
const vorsteuerRow = {
  date: "13.04.2026",
  title: "Ads",
  vendor: "Amazon Online Germany GmbH",
  invoice_number: "1691682M5PA26",
  vendor_vat_number: "",
  tax_number: "",
  net_amount: "506.65",
  vat_rate: "19%",
  vat_amount: "96.26",
  amount: "602.91",
};

describe("vorsteuer — happy path", () => {
  it("parses a German dot date", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2026-04-13");
  });

  it("stores GROSS as amount and strips the percent from the rate", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow, 2);
    expect(row.data?.amount).toBe(602.91);
    expect(row.data?.vat_rate).toBe(19);
  });

  it("assigns a category from the description", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow, 2);
    expect(row.data?.category).toBe("advertising");
  });
});

describe("vorsteuer — VAT", () => {
  it("uses the file's vat_amount, never a derived one", () => {
    // 34.70 gross at a stated 19% would DERIVE 5.54 of VAT, but Amazon
    // actually charged 0.00 on this line. Deriving would invent tax.
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      title: 'Gebühren im Zusammenhang mit "Versand durch Amazon"',
      net_amount: "34.70",
      vat_rate: "19%",
      vat_amount: "0.00",
      amount: "34.70",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_amount).toBe(0);
  });

  it("errors when net + vat disagrees with gross beyond 2 cents", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      net_amount: "100.00",
      vat_amount: "19.00",
      amount: "150.00",
    }, 2);
    expect(row.error).toContain("does not reconcile");
  });

  it("tolerates a 2-cent rounding difference", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      net_amount: "100.00",
      vat_amount: "19.00",
      amount: "119.02",
    }, 2);
    expect(row.error).toBeNull();
  });
});

describe("vorsteuer — credit notes", () => {
  it("accepts a negative amount and negative VAT", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      title: "Erstattung von Verkäufergebühren",
      net_amount: "-104.04",
      vat_amount: "-19.77",
      amount: "-123.81",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.amount).toBe(-123.81);
    expect(row.data?.vat_amount).toBe(-19.77);
  });
});

describe("vorsteuer — tax identifiers", () => {
  it("prefers the UStID", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, vendor_vat_number: "DE814584193", tax_number: "18/294/22775",
    }, 2);
    expect(row.data?.vendor_vat_number).toBe("DE814584193");
  });

  it("falls back to the Steuernummer per ROW when the UStID is blank", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, vendor_vat_number: "", tax_number: "18/294/22775",
    }, 2);
    expect(row.data?.vendor_vat_number).toBe("18/294/22775");
  });
});

describe("classifySkip — vorsteuer only", () => {
  it("skips the trailing Total row", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, date: "Total", title: "", vendor: "",
    })).toBe("summary row");
  });

  it("skips a zero-amount filler row", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, date: "", title: "Ads", net_amount: "0.00", vat_amount: "0.00", amount: "0",
    })).toBe("zero amount");
  });

  it("skips an unsupported currency", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, currency: "JPY",
    })).toBe("unsupported currency");
  });

  it("does not skip a real row", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow)).toBeNull();
  });

  it("skips NOTHING for the generic format", () => {
    // The format guard must be the first statement in the function.
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.generic, {
      date: "", title: "", amount: "0",
    })).toBeNull();
  });
});

describe("generic format", () => {
  it("still requires date, title and amount", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.generic, {
      date: "2026-01-15", title: "", amount: "10",
    }, 2);
    expect(row.error).toContain("title");
  });

  it("now accepts a German date and decimal comma", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.generic, {
      date: "15.01.2026", title: "Büromaterial", amount: "1.234,56",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2026-01-15");
    expect(row.data?.amount).toBe(1234.56);
  });

  it("still errors on a blank row instead of skipping it", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.generic, {
      date: "", title: "", amount: "",
    }, 2);
    expect(row.error).not.toBeNull();
  });
});
