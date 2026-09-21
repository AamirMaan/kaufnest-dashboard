/**
 * CSV/Excel import format registry for the Purchases import
 * (`ImportPurchasesModal`). One format only — no multi-format dropdown,
 * matching Expenses' simpler single-format shape more than Sales' three.
 *
 * Extracted (2026-09-17) from `ImportPurchasesModal.tsx`'s previously
 * inline `validateRow`, which had none of the tolerance Sales/Expenses
 * already had: exact hardcoded header names (no German aliases), a strict
 * `^\d{4}-\d{2}-\d{2}$` date regex (no DD.MM.YYYY/DD-MM-YYYY), and raw
 * `parseInt`/`parseFloat` (no decimal-comma tolerance). This registry is a
 * strict superset — any file that imported successfully before still does.
 *
 * Pure module (no React/Supabase/Redux) — tested in
 * `purchaseImportFormats.test.ts`.
 */

import type { Purchase, Currency } from "@/types";
import {
  ALIASES,
  resolveHeaders,
  canonicalizeRow,
  type ColumnSpec,
  type HeaderResolution,
} from "@/lib/utils/importAliases";
import { parseLocaleNumber, parseFlexibleDate, type DateOrder } from "@/lib/utils/localeParse";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { resolveSheetCurrency } from "@/lib/fx/convert";

export { resolveHeaders, canonicalizeRow, type HeaderResolution };

const col = (key: string, required = false): ColumnSpec => ({
  key,
  aliases: ALIASES[key] ?? [key],
  required,
});

export const PURCHASE_IMPORT_COLUMNS: ColumnSpec[] = [
  col("date", true),
  col("product_name", true),
  col("vendor"),
  col("quantity", true),
  col("unit_price", true),
  col("currency"),
  col("vat_rate"),
  col("description"),
];

/** Derived from the column registry so the two can't drift. */
export const TEMPLATE_HEADERS = PURCHASE_IMPORT_COLUMNS.map((c) => c.key);
export const TEMPLATE_EXAMPLE = [
  "2024-01-15", "Blue Widget", "Acme Supplies", "50", "4.99", "EUR", "19", "Sample purchase",
];

/** What an imported row becomes — same shape the modal has always inserted. */
export type PurchaseImportData = Omit<Purchase, "id" | "created_by" | "created_at" | "product_id">;

export interface ParsedPurchaseRow {
  rowNum: number;
  data: PurchaseImportData | null;
  error: string | null;
  /**
   * Set to the sheet's raw ISO code when this row's currency differs from
   * the tenant's base currency — null when no conversion is needed. See
   * `sheetCurrency` on Sales' `ParsedRow` (`importFormats.ts`) for the full
   * two-pass row lifecycle this drives.
   */
  sheetCurrency?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validate one canonicalized row. Error messages keep the established
 * `Row N: …` style so the modal renders them unchanged.
 */
export function validatePurchaseRow(
  raw: Record<string, string>,
  rowNum: number,
  dateOrder: DateOrder = "dmy",
  // Defaulted to "EUR" for the same reason as Sales'/Expenses' validators —
  // avoids a mechanical argument addition across every test call site;
  // ImportPurchasesModal.tsx always passes the tenant's actual base currency.
  baseCurrency: Currency = "EUR",
): ParsedPurchaseRow {
  const fail = (error: string): ParsedPurchaseRow => ({
    rowNum,
    data: null,
    error: `Row ${rowNum}: ${error}`,
  });

  const date = parseFlexibleDate(raw.date, dateOrder);
  if (!date) {
    return fail(`invalid or missing "date" (expected YYYY-MM-DD, DD.MM.YYYY, or DD-MM-YYYY)`);
  }

  const productName = raw.product_name?.trim();
  if (!productName) {
    return fail(`missing "product_name"`);
  }

  const quantityNum = parseLocaleNumber(raw.quantity);
  if (quantityNum === null || !Number.isInteger(quantityNum) || quantityNum <= 0) {
    return fail(`"quantity" must be a positive integer`);
  }
  const quantity = quantityNum;

  const unitPriceNum = parseLocaleNumber(raw.unit_price);
  if (unitPriceNum === null || unitPriceNum <= 0) {
    return fail(`"unit_price" must be a positive number`);
  }
  const unitPrice = unitPriceNum;

  const currencyResult = resolveSheetCurrency(raw.currency, baseCurrency);
  if ("error" in currencyResult) {
    return fail(currencyResult.error);
  }
  const { currency, sheetCurrency } = currencyResult;

  const vatRateRaw = raw.vat_rate?.trim();
  const vatRate = vatRateRaw ? parseLocaleNumber(vatRateRaw) : null;
  if (vatRateRaw && (vatRate === null || vatRate < 0 || vatRate > 100)) {
    return fail(`"vat_rate" must be between 0 and 100`);
  }

  const totalAmount = round2(quantity * unitPrice);
  const vatAmount = vatRate ? vatAmountFromGross(totalAmount, vatRate) : null;

  return {
    rowNum,
    data: {
      product_name: productName,
      vendor: raw.vendor?.trim() || null,
      quantity,
      unit_price: unitPrice,
      total_amount: totalAmount,
      currency,
      date,
      description: raw.description?.trim() || null,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      sale_id: null,
      // Left null at parse time regardless of sheetCurrency — the two-pass
      // row lifecycle only converts (via applyRate) after the user confirms
      // a rate in the FX review step (Task 14, ImportPurchasesModal.tsx).
      original_currency: null,
      original_total_amount: null,
      fx_rate: null,
      fx_rate_date: null,
    },
    error: null,
    sheetCurrency,
  };
}
