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
  /**
   * One example row for the downloadable template, **ordered to match
   * `columns`** — the modal emits `columns.map(c => c.key)` as the header line,
   * so any other order silently mislabels every cell.
   *
   * Most of a template's value is the example, not the headers: it is what
   * documents the accepted date format and (for `generic`) the category
   * vocabulary. Optional so a future format can ship header-only rather than
   * ship a wrong example.
   */
  templateExample?: string[];
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
    label: "Generic (Boughtopia template)",
    classifiesSkips: false,
    columns: [
      col("date", true), col("title", true), col("amount", true),
      col("category"), col("vendor"), col("currency"), col("vat_rate"),
      col("description"), col("invoice_number"), col("vendor_vat_number"),
    ],
    // The historical template row, re-ordered to match `columns` above (the old
    // constant listed category/vendor before amount). Its job is to show the
    // ISO date shape and one member of the category vocabulary.
    templateExample: [
      "2024-01-15", "Office Supplies", "49.99",
      "office", "Staples", "EUR", "19",
      "Monthly supplies", "RE-2024-001", "DE123456789",
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
    // A real ledger line, ordered to match `columns` above. Chosen so the
    // example itself documents the three things this format is easiest to get
    // wrong: `amount` is the GROSS figure (602.91), not the net (506.65); the
    // rate may carry its percent sign ("19%"); and `net + vat` must reconcile
    // with gross — 506.65 + 96.26 = 602.91, the same figures the reconciliation
    // check's comment uses. `tax_number` is left blank on purpose: the ledger
    // fills whichever identifier a vendor has, and the two columns are merged
    // per row by `validateExpenseRow`.
    templateExample: [
      "13.04.2026", "Ads", "602.91",
      "506.65", "19%", "96.26",
      "Amazon Online Germany GmbH", "EUR", "1691682M5PA26",
      "DE123456789", "",
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
  const amountRaw = raw.amount?.trim() ?? "";

  // 1. No date and no amount — nothing that could be an expense. Covers the
  //    fully blank filler lines AND the section-header rows, which carry a
  //    title and nothing else. `title` is deliberately NOT part of this test:
  //    requiring it to be empty too would let a header row fall through to the
  //    date error below and, since validation is all-or-nothing, one header
  //    line would make the whole file unimportable.
  //    Other columns may still hold a stray figure (the ledger's tail has a
  //    lone net total), so only these two decide it. The zero-amount filler
  //    rows are unaffected — their `amount` is the non-empty string "0", so
  //    they fall through to rule 3 and report as "zero amount", not "blank".
  if (!date && !amountRaw) return "blank row";

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

  // `net_amount` is not a column on `Expense`. The ledger supplies it as a
  // cross-check against gross, and — see below — as the preferred basis for
  // VAT when the VAT column is missing.
  const netRaw = raw.net_amount?.trim();
  let net: number | null = null;
  if (netRaw) {
    const parsedNet = parseLocaleNumber(netRaw);
    if (parsedNet === null) {
      return fail(`"net_amount" must be a number`);
    }
    net = round2(parsedNet);
  }

  // VAT precedence: the FILE, then arithmetic, then the rate. Anything
  // derivable from `vat_rate` is the LAST resort, because a stated rate is not
  // evidence that the tax was charged: four real ledger rows state 19 %
  // against €0.00 of actual VAT (`Gebühren im Zusammenhang mit "Versand durch
  // Amazon"`, 34.70 gross, 0.00 VAT). Deriving from the rate there would
  // invent €5.54 of input tax that never existed — on a filed VAT return.
  const vatAmountRaw = raw.vat_amount?.trim();
  let vatAmount: number | null;
  if (vatAmountRaw) {
    // 1. The file said so. Signed, not absolute — a credit note's VAT is
    //    negative input tax.
    const parsed = parseLocaleNumber(vatAmountRaw);
    if (parsed === null) {
      return fail(`"vat_amount" must be a number`);
    }
    vatAmount = round2(parsed);
  } else if (net !== null) {
    // 2. `gross − net` is arithmetic truth where the rate is only a guess, and
    //    the two DO disagree on the 0.00-VAT rows above. It also inherits the
    //    sign for free: −123.81 gross less −104.04 net is −19.77, the real
    //    figure from the ledger's credit-note row.
    vatAmount = round2(amount - net);
  } else if (vatRate !== null) {
    // 3. No VAT column and no net column — the rate is all that is left.
    //    `!== null`, not truthiness: a stated 0 % is a real answer (zero-rated
    //    intra-EU supplies are ordinary in a German ledger), and treating it as
    //    "no rate" would store `vat_rate: 0` beside `vat_amount: null`, which
    //    reads downstream as *unknown* rather than *zero*.
    //    `vatAmountFromGross` short-circuits to 0 for a non-positive rate, so
    //    the sign has to be carried explicitly: derive from the magnitude and
    //    put the amount's sign back. A credit note must never yield POSITIVE
    //    input tax — that would claim money back on a refund.
    const derived = vatAmountFromGross(Math.abs(amount), vatRate);
    vatAmount = amount < 0 ? -derived : derived;
  } else {
    vatAmount = null;
  }

  // net + VAT must agree with gross, or the row describes money we cannot
  // account for. Two cents of tolerance absorbs the ledger's own per-line
  // rounding (and IEEE 754 — `506.65 + 96.26` is not exactly `602.91`).
  //
  // This runs whether `vat_amount` came from the file or from branch 2; the
  // check must not silently disappear depending on which branch produced the
  // value. Via branch 2 it holds by construction, and a check that is
  // trivially true is still the check. Branch 3 is unreachable here — it only
  // fires when `net` is null.
  if (net !== null && vatAmount !== null) {
    if (Math.abs(net + vatAmount - amount) > 0.02) {
      return fail(
        `"amount" (${amount}) does not reconcile with net + VAT (${round2(net + vatAmount)})`,
      );
    }
  }

  // A rate stated as a FRACTION ("0.19") rather than a percentage ("19") is
  // the one bad rate this importer cannot see on its own: 0.19 sits happily
  // inside the 0–100 range above and would be stored as `vat_rate: 0.19`, a
  // 0.19 % rate, with nothing downstream to catch it. It is not hypothetical —
  // the modal accepts .xlsx, and opening the ledger in Excel and re-saving it
  // turns the rate column into percentage-formatted cells, which `excel.ts`
  // stringifies as "0.19".
  //
  // Deliberately NOT fixed with a magnitude heuristic (`if (rate < 1) rate *=
  // 100`) — that was rejected on the Sales branch because it silently corrupts
  // a genuine 100 % rate. Instead the rate is cross-checked against the row's
  // OWN arithmetic, which this ledger always supplies: net × rate must land on
  // the resolved VAT, within the same 2 cents the reconciliation above allows.
  // A fraction rate misses by two orders of magnitude, so it cannot hide.
  //
  // `vatAmount !== 0` is LOAD-BEARING, not defensive. Four real ledger rows
  // state 19 % against €0.00 of actual VAT (`Gebühren im Zusammenhang mit
  // "Versand durch Amazon"`, 34.70 gross / 0.00 VAT). For those, net × rate is
  // 6.59 against a stated 0.00 — a genuine, intended disagreement between rate
  // and amount that `vat_amount` wins (see the VAT-precedence comment above).
  // Dropping this condition would reject four valid rows and, since validation
  // is all-or-nothing, make the real quarterly file unimportable.
  if (net !== null && vatAmount !== null && vatRate !== null && vatAmount !== 0) {
    const expectedFromRate = (net * vatRate) / 100;
    if (Math.abs(vatAmount - expectedFromRate) > 0.02) {
      return fail(
        `"vat_rate" (${vatRate}) disagrees with the row's own figures — ` +
          `net ${net} × ${vatRate}% is ${round2(expectedFromRate)}, but "vat_amount" is ${vatAmount}. ` +
          `A rate column reading "0.19" rather than "19" usually means the sheet was ` +
          `re-saved from Excel with percentage formatting`,
      );
    }
  }

  // The ledger has no category column, so `vorsteuer` always derives one from
  // the description. `generic` keeps its explicit column as the authority and
  // only guesses when the column is ABSENT — an importer that overrode a
  // user's stated category would be changing their data.
  //
  // Tested against `format.id`, not `classifiesSkips`: whether a sheet carries
  // noise rows and whether an explicit category may win are unrelated ideas,
  // and a future format declared `classifiesSkips: true` WITH a category
  // column would silently discard every user-stated category. (Sales draws the
  // same distinction with a dedicated `vatRateIsFraction` flag.)
  //
  // `undefined` (column absent) and `""` (column present, cell blank) are
  // deliberately NOT the same thing: a blank cell keeps the historical `other`
  // default, so re-importing an old generic template with some cells left
  // empty doesn't start guessing categories the user never chose.
  const categoryRaw = raw.category?.trim().toLowerCase();
  let category: ExpenseCategory;
  if (format.id === "vorsteuer" || categoryRaw === undefined) {
    category = categoryFor(title);
  } else if (!categoryRaw) {
    category = "other";
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
