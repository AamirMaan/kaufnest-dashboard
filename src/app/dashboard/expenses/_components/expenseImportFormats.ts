/**
 * CSV import format registry for the Expenses import (`ImportExpensesModal`).
 *
 * Two formats: "generic" (the original template, back-compat) and "vorsteuer"
 * (a German input-tax ledger — Vorsteuerkonto — exported quarterly, whose rows
 * carry a net/VAT/gross triple, a per-row vendor tax identifier, and a fair
 * amount of non-expense noise: blank filler, zero-amount padding and a
 * trailing "Total" summary row).
 *
 * German tolerance applies to BOTH formats: header aliases (Datum, Betrag,
 * Brutto, Lieferant, …), decimal commas ("1.234,56"), German dates
 * ("15.01.2026") and percent-suffixed rates ("19%") — via
 * `lib/utils/localeParse`. Delimiter/BOM handling lives in `lib/utils/csv`.
 *
 * Pure module (no React/Supabase/Redux) — tested in
 * `expenseImportFormats.test.ts`. To add a new format, edit THIS file; to add a
 * header alias, edit `lib/utils/importAliases` (shared with Sales).
 */

import type { Expense, ExpenseCategory, Currency } from "@/types";
import { ALIASES, type ColumnSpec } from "@/lib/utils/importAliases";
import {
  parseLocaleNumber,
  parseLocaleRate,
  parseFlexibleDate,
  type DateOrder,
} from "@/lib/utils/localeParse";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { categoryFor } from "../_lib/expenseCategory";

// No re-export of `resolveHeaders`/`canonicalizeRow` here. Sales re-exports
// them only because ImportSalesModal already imported them from its registry;
// the expenses modal is new code and imports them straight from
// @/lib/utils/importAliases.

const VALID_CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];
const VALID_CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office", "inventory", "tax", "salary", "other",
];

export type ExpenseImportFormatId = "generic" | "vorsteuer";
export type SkipReason = "blank row" | "summary row" | "zero amount" | "unsupported currency";

export interface ExpenseImportFormat {
  id: ExpenseImportFormatId;
  label: string;
  columns: ColumnSpec[];
  /** Only `vorsteuer` tolerates noise rows. See classifySkip's first statement. */
  classifiesSkips: boolean;
}

/** What an imported row becomes — the shape the modal inserts. */
export type ExpenseImportData = Omit<Expense, "id" | "created_by" | "created_at">;

export interface ParsedExpenseRow {
  rowNum: number;
  data: ExpenseImportData | null;
  error: string | null;
  /** Set when the row is deliberately not imported rather than errored. */
  skipped?: SkipReason;
}

// ─── Header aliases (shared with Sales — see `lib/utils/importAliases`) ───────

const col = (key: string, required = false): ColumnSpec => ({
  key,
  aliases: ALIASES[key] ?? [key],
  required,
});

// ─── Formats ──────────────────────────────────────────────────────────────────

export const EXPENSE_IMPORT_FORMATS: Record<ExpenseImportFormatId, ExpenseImportFormat> = {
  generic: {
    id: "generic",
    label: "Generic (KaufNest template)",
    classifiesSkips: false,
    columns: [
      col("date", true), col("title", true), col("amount", true),
      col("category"), col("vendor"), col("currency"), col("vat_rate"),
      col("description"), col("invoice_number"), col("vendor_vat_number"),
    ],
  },
  vorsteuer: {
    id: "vorsteuer",
    label: "German VAT ledger (Vorsteuerkonto)",
    classifiesSkips: true,
    columns: [
      col("date", true),
      // The ledger's "Description" column IS the title. There is deliberately
      // no separate `description` column for this format — one sheet column
      // cannot resolve to two keys.
      { key: "title", aliases: [...ALIASES.title, ...ALIASES.description], required: true },
      col("amount", true),
      col("net_amount"), col("vat_rate"), col("vat_amount"),
      col("vendor"), col("currency"), col("invoice_number"),
      col("vendor_vat_number"), col("tax_number"),
    ],
  },
};

export const EXPENSE_IMPORT_FORMAT_IDS: ExpenseImportFormatId[] = ["generic", "vorsteuer"];

// ─── Skip classification ──────────────────────────────────────────────────────

/**
 * Classify a row that should be skipped rather than errored. Only applies to
 * formats whose sheets carry non-expense rows (currently `vorsteuer`) — a real
 * quarterly ledger ends in a "Total" summary row and pads its sections with
 * blank and 0.00 filler lines. Erroring on those would make the file
 * impossible to import, since validation is all-or-nothing.
 *
 * The rule ORDER below is load-bearing: a real filler row matches more than one
 * rule, and only the stated order classifies each one the way the file means it.
 */
export function classifySkip(
  format: ExpenseImportFormat,
  raw: Record<string, string>,
): SkipReason | null {
  // The format guard MUST be the first statement. Every reason below applies
  // only to sheets that carry noise rows; putting any check above this line
  // would make `generic` silently skip the blank rows it is required to error
  // on. This exact bug shipped once in the Sales module.
  if (!format.classifiesSkips) return null;

  const date = raw.date?.trim() ?? "";
  const title = raw.title?.trim() ?? "";
  const amountRaw = raw.amount?.trim() ?? "";

  // 1. Nothing identifying at all. Other columns may still hold a stray
  //    figure (the ledger's tail has a lone net total), so only these three
  //    decide it.
  if (!date && !title && !amountRaw) return "blank row";

  // 2. A date cell that is not a date — the trailing "Total" row.
  //    Checked only when the cell is non-empty, so the zero-amount filler
  //    rows below (which have NO date) fall through to rule 3.
  if (date && parseFlexibleDate(date) === null) return "summary row";

  // 3. A row that carries no money. The ledger pads with `0.00` "Ads" rows.
  const amount = parseLocaleNumber(amountRaw);
  if (amount === 0) return "zero amount";

  const currency = raw.currency?.trim().toUpperCase();
  if (currency && !VALID_CURRENCIES.includes(currency as Currency)) {
    return "unsupported currency";
  }
  return null;
}

// ─── Row validation ───────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validate one canonicalized row against a format. Error messages keep the
 * established `Row N: …` style so the modal renders them unchanged.
 */
export function validateExpenseRow(
  format: ExpenseImportFormat,
  raw: Record<string, string>,
  rowNum: number,
  dateOrder: DateOrder = "dmy",
): ParsedExpenseRow {
  const fail = (error: string): ParsedExpenseRow => ({
    rowNum,
    data: null,
    error: `Row ${rowNum}: ${error}`,
  });

  const skipReason = classifySkip(format, raw);
  if (skipReason) {
    return { rowNum, data: null, error: null, skipped: skipReason };
  }

  const date = parseFlexibleDate(raw.date, dateOrder);
  if (!date) {
    return fail(`invalid or missing "date" (expected YYYY-MM-DD, DD.MM.YYYY, or DD-MM-YYYY)`);
  }

  const title = raw.title?.trim();
  if (!title) {
    return fail(`missing "title"`);
  }

  // An expense amount may be NEGATIVE (a credit note — "Erstattung von
  // Verkäufergebühren", −123.81) or ZERO. `expenses_amount_check` was dropped
  // for exactly this reason, so only a NON-NUMERIC value is a row error. Do
  // not reintroduce an `amount <= 0` rejection here.
  const parsedAmount = parseLocaleNumber(raw.amount);
  if (parsedAmount === null) {
    return fail(`"amount" must be a number`);
  }
  const amount = round2(parsedAmount);

  const currency = (raw.currency?.trim().toUpperCase() || "EUR") as Currency;
  if (!VALID_CURRENCIES.includes(currency)) {
    return fail(`invalid "currency" "${raw.currency}" — use: ${VALID_CURRENCIES.join(", ")}`);
  }

  // German ledgers write the rate as "19%"; `parseLocaleNumber` rejects the
  // percent sign outright, so rates go through `parseLocaleRate`.
  const vatRateRaw = raw.vat_rate?.trim();
  const vatRate = vatRateRaw ? parseLocaleRate(vatRateRaw) : null;
  if (vatRateRaw && (vatRate === null || vatRate < 0 || vatRate > 100)) {
    return fail(`"vat_rate" must be between 0 and 100`);
  }

  // The FILE's vat_amount always wins over anything derivable from the rate.
  // Four real ledger rows state a 19 % rate against €0.00 of actual VAT
  // (`Gebühren im Zusammenhang mit "Versand durch Amazon"`, 34.70 gross, 0.00
  // VAT). Deriving from the rate would invent €5.54 of input tax that was
  // never charged — on a filed VAT return. Derivation is a fallback for files
  // with no vat_amount column at all, nothing more.
  const vatAmountRaw = raw.vat_amount?.trim();
  let vatAmount: number | null;
  if (vatAmountRaw) {
    const parsed = parseLocaleNumber(vatAmountRaw);
    if (parsed === null) {
      return fail(`"vat_amount" must be a number`);
    }
    // Signed, not absolute: a credit note's VAT is negative input tax.
    vatAmount = round2(parsed);
  } else if (vatRate) {
    // `vatAmountFromGross` short-circuits to 0 for a non-positive rate, so the
    // sign has to be carried explicitly: derive from the magnitude and put the
    // amount's sign back. A credit note must never yield POSITIVE input tax —
    // that would claim back money on a refund.
    const derived = vatAmountFromGross(Math.abs(amount), vatRate);
    vatAmount = amount < 0 ? -derived : derived;
  } else {
    vatAmount = null;
  }

  // `net_amount` is not a column on `Expense` — the ledger supplies it purely
  // as a cross-check. When all three of net/VAT/gross are present they must
  // agree, or the row is describing money we cannot account for. Two cents of
  // tolerance absorbs the ledger's own per-line rounding.
  const netRaw = raw.net_amount?.trim();
  if (netRaw && vatAmountRaw && vatAmount !== null) {
    const net = parseLocaleNumber(netRaw);
    if (net === null) {
      return fail(`"net_amount" must be a number`);
    }
    if (Math.abs(net + vatAmount - amount) > 0.02) {
      return fail(
        `"amount" (${amount}) does not reconcile with net + VAT (${round2(net + vatAmount)})`,
      );
    }
  }

  // The ledger has no category column, so `vorsteuer` always derives one from
  // the description. `generic` keeps its explicit column as the authority and
  // only falls back to the guess when the column is absent — an importer that
  // overrode a user's stated category would be changing their data.
  const categoryRaw = raw.category?.trim().toLowerCase();
  let category: ExpenseCategory;
  if (format.classifiesSkips || !categoryRaw) {
    category = categoryFor(title);
  } else {
    if (!VALID_CATEGORIES.includes(categoryRaw as ExpenseCategory)) {
      return fail(
        `invalid "category" "${raw.category}" — use: ${VALID_CATEGORIES.join(", ")}`,
      );
    }
    category = categoryRaw as ExpenseCategory;
  }

  // The ledger fills whichever identifier a vendor has — fuel-station rows
  // carry only a Steuernummer, most others only a UStID. `resolveHeaders` maps
  // one header per key, so the two columns resolve to separate keys and are
  // merged PER ROW here rather than in the alias table.
  const vendorVatNumber = raw.vendor_vat_number?.trim() || raw.tax_number?.trim() || null;

  return {
    rowNum,
    data: {
      title,
      amount,
      currency,
      category,
      vendor: raw.vendor?.trim() || null,
      date,
      description: raw.description?.trim() || null,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      vendor_vat_number: vendorVatNumber,
      invoice_number: raw.invoice_number?.trim() || null,
    },
    error: null,
  };
}
