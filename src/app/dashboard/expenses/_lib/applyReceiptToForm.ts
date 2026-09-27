import type { Currency, ExpenseCategory } from "@/types";
import type { ParsedReceipt } from "./parseReceipt";

/** The expense-form fields a receipt can fill — shared by the Add and Edit modals' FormState. */
export interface ReceiptFillableForm {
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string;
  date: string;
  vat_included: boolean;
  vat_rate: string;
  vendor_vat_number: string;
  invoice_number: string;
}

export type ReceiptField = keyof ReceiptFillableForm;

/**
 * Values that still count as "untouched" for fields that are never blank.
 * The Add modal passes its defaults (today's date, EUR, "other") so a
 * receipt can replace them; the Edit modal passes `{}`, so only genuinely
 * empty fields are filled on an existing expense.
 */
export type ReceiptFillBaseline = Partial<Pick<ReceiptFillableForm, "currency" | "category" | "date">>;

/**
 * Merge a parsed receipt into the form without ever overwriting something
 * the user typed. Returns the next form and the fields whose value actually
 * changed (for the highlight and the "Filled N fields" toast).
 */
export function applyReceiptToForm<F extends ReceiptFillableForm>(
  form: F,
  parsed: ParsedReceipt,
  baseline: ReceiptFillBaseline
): { form: F; filled: ReceiptField[] } {
  const next: F = { ...form };
  const filled: ReceiptField[] = [];

  function fill<K extends ReceiptField>(key: K, value: F[K]) {
    if (next[key] === value) return;
    next[key] = value;
    if (!filled.includes(key)) filled.push(key);
  }

  const blank = (v: string) => v.trim() === "";

  if (parsed.amount !== undefined && blank(form.amount)) fill("amount", parsed.amount.toFixed(2) as F["amount"]);
  if (parsed.currency && form.currency === baseline.currency) fill("currency", parsed.currency as F["currency"]);
  if (parsed.date && (blank(form.date) || form.date === baseline.date)) fill("date", parsed.date as F["date"]);
  if (parsed.category && form.category === baseline.category) fill("category", parsed.category as F["category"]);
  if (parsed.vendor && blank(form.vendor)) fill("vendor", parsed.vendor as F["vendor"]);
  if (parsed.invoiceNumber && blank(form.invoice_number)) fill("invoice_number", parsed.invoiceNumber as F["invoice_number"]);
  if (parsed.vendorVatNumber && blank(form.vendor_vat_number)) {
    fill("vendor_vat_number", parsed.vendorVatNumber as F["vendor_vat_number"]);
  }
  // "VAT not ticked" is the empty state for the VAT pair.
  if (parsed.vatRate !== undefined && !form.vat_included) {
    fill("vat_included", true as F["vat_included"]);
    fill("vat_rate", String(parsed.vatRate) as F["vat_rate"]);
  }

  return { form: next, filled };
}
