import { applyReceiptToForm, type ReceiptFillableForm } from "./applyReceiptToForm";

const addDefaults = (): ReceiptFillableForm & { title: string } => ({
  title: "",
  amount: "",
  currency: "EUR",
  category: "other",
  vendor: "",
  date: "2026-09-27",
  vat_included: false,
  vat_rate: "19",
  vendor_vat_number: "",
  invoice_number: "",
});
const ADD_BASELINE = { currency: "EUR", category: "other", date: "2026-09-27" } as const;

const parsed = {
  date: "2026-09-14",
  amount: 44.63,
  currency: "GBP" as const,
  vatRate: 20,
  vatAmount: 7.44,
  vendorVatNumber: "GB123456789",
  invoiceNumber: "INV-1",
  vendor: "Acme Ltd",
  category: "shipping" as const,
};

describe("applyReceiptToForm", () => {
  it("fills every untouched field of a fresh Add form", () => {
    const { form, filled } = applyReceiptToForm(addDefaults(), parsed, ADD_BASELINE);
    expect(form).toMatchObject({
      amount: "44.63",
      currency: "GBP",
      date: "2026-09-14",
      category: "shipping",
      vendor: "Acme Ltd",
      invoice_number: "INV-1",
      vendor_vat_number: "GB123456789",
      vat_included: true,
      vat_rate: "20",
    });
    expect(filled.sort()).toEqual(
      ["amount", "category", "currency", "date", "invoice_number", "vat_included", "vat_rate", "vendor", "vendor_vat_number"].sort()
    );
  });

  it("never overwrites what the user typed", () => {
    const typed = { ...addDefaults(), amount: "10.00", vendor: "Mine", currency: "USD" as const, date: "2026-01-01" };
    const { form, filled } = applyReceiptToForm(typed, parsed, ADD_BASELINE);
    expect(form).toMatchObject({ amount: "10.00", vendor: "Mine", currency: "USD", date: "2026-01-01" });
    expect(filled).not.toEqual(expect.arrayContaining(["amount", "vendor", "currency", "date"]));
  });

  it("leaves VAT alone once the user has ticked it", () => {
    const typed = { ...addDefaults(), vat_included: true, vat_rate: "7" };
    const { form, filled } = applyReceiptToForm(typed, parsed, ADD_BASELINE);
    expect(form.vat_rate).toBe("7");
    expect(filled).not.toContain("vat_rate");
  });

  it("with an empty baseline (Edit modal), only fills blank fields", () => {
    const existing = { ...addDefaults(), amount: "5.00", date: "2026-02-02", vendor: "" };
    const { form, filled } = applyReceiptToForm(existing, parsed, {});
    expect(form).toMatchObject({ amount: "5.00", date: "2026-02-02", currency: "EUR", category: "other", vendor: "Acme Ltd" });
    expect(filled).toEqual(expect.arrayContaining(["vendor", "invoice_number", "vendor_vat_number", "vat_included", "vat_rate"]));
    expect(filled).not.toEqual(expect.arrayContaining(["currency"]));
  });

  it("does not report a field whose value is unchanged", () => {
    const { filled } = applyReceiptToForm(addDefaults(), { currency: "EUR" }, ADD_BASELINE);
    expect(filled).toEqual([]);
  });

  it("keeps non-receipt fields such as title untouched", () => {
    const { form } = applyReceiptToForm({ ...addDefaults(), title: "Packing tape" }, parsed, ADD_BASELINE);
    expect(form.title).toBe("Packing tape");
  });

  it("fills nothing from an empty parse", () => {
    const start = addDefaults();
    const { form, filled } = applyReceiptToForm(start, {}, ADD_BASELINE);
    expect(form).toEqual(start);
    expect(filled).toEqual([]);
  });

  it("ticks vat_included but reports no vat_rate change when the parsed rate already matches", () => {
    const start = { ...addDefaults(), vat_included: false, vat_rate: "19" };
    const { form, filled } = applyReceiptToForm(start, { vatRate: 19 }, ADD_BASELINE);
    expect(form.vat_included).toBe(true);
    expect(form.vat_rate).toBe("19");
    expect(filled).toEqual(["vat_included"]);
  });
});
