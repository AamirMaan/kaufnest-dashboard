/**
 * CSV import format registry for the Sales import (`ImportSalesModal`).
 *
 * Three formats: "generic" (the original template, back-compat), "amazon"
 * and "ebay" (richer KaufNest-defined templates whose rows carry an
 * `order_id` → `external_order_id`, a gross `total`, and per-order fees;
 * the platform is forced by the format).
 *
 * German tolerance applies to ALL formats: header aliases (Datum,
 * Artikelname, Menge, …), decimal commas ("9,99"), German dates
 * ("15.01.2024") — via `lib/utils/localeParse`. Delimiter/BOM handling
 * lives in `lib/utils/csv`.
 *
 * Pure module (no React/Supabase/Redux) — tested in `importFormats.test.ts`.
 * To add a new format or header alias, edit THIS file only.
 */

import type { Platform, Currency, Sale } from "@/types";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { parseLocaleNumber, parseFlexibleDate } from "@/lib/utils/localeParse";

export const VALID_PLATFORMS: Platform[] = ["amazon", "ebay", "etsy", "shopify", "other"];
export const VALID_CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

export type ImportFormatId = "generic" | "amazon" | "ebay";

/** What an imported row becomes — same shape the modal has always inserted. */
export type SaleImportData = Omit<Sale, "id" | "created_by" | "created_at" | "product_id">;

export interface ParsedRow {
  rowNum: number;
  data: SaleImportData | null;
  error: string | null;
  /** Set by the modal's duplicate pre-check (I3) — row is valid but not imported. */
  skipped?: string | null;
  /** Raw SKU from the CSV — modal resolves this to product_id at insert time. */
  sku?: string | null;
}

interface ColumnSpec {
  /** Canonical key, e.g. "unit_price". */
  key: string;
  /** Lowercase header names (EN + DE) that resolve to this column. */
  aliases: string[];
  required: boolean;
}

export interface ImportFormat {
  id: ImportFormatId;
  label: string;
  /** Non-null → every row gets this platform; the platform column is ignored. */
  forcedPlatform: Platform | null;
  columns: ColumnSpec[];
  templateHeaders: string[];
  templateExample: string[];
  /**
   * Amazon reports VAT rates as fractions (0.19), not percentages (19).
   * Without scaling, 0.19 passes the 0–100 check and is stored as 0.19 %.
   */
  vatRateIsFraction?: boolean;
  /**
   * Amazon has NO per-unit price column. Its `unit_price` column is really
   * TOTAL_PRICE_OF_ITEMS_AMT_VAT_INCL — the whole line — and its `total` is
   * items + shipping. See Task 2.
   */
  priceColumnsAreLineTotals?: boolean;
}

// ─── Header aliases (all lowercase — parseCsvText lowercases headers) ────────

const ALIASES: Record<string, string[]> = {
  date: ["date", "datum", "bestelldatum", "verkaufsdatum"],
  product_name: ["product_name", "product", "artikel", "artikelname", "artikelbezeichnung", "titel", "produktname", "produkt"],
  platform: ["platform", "plattform"],
  quantity: ["quantity", "qty", "menge", "anzahl", "stück", "stueck", "stk"],
  unit_price: ["unit_price", "price", "preis", "stückpreis", "stueckpreis", "einzelpreis"],
  // "Versandkosten" on an order sheet means what the buyer paid → shipping_charged (I6).
  total: ["total", "total_amount", "gesamt", "gesamtbetrag", "gesamtpreis", "brutto", "verkaufsbetrag", "summe"],
  currency: ["currency", "währung", "waehrung"],
  vat_rate: ["vat_rate", "vat", "mwst", "mwst-satz", "mwst.", "ust", "ust-satz", "steuersatz"],
  vat_amount: ["vat_amount", "vat_betrag", "mwst_betrag", "mwstbetrag", "steuerbetrag"],
  status: ["status", "bestellstatus"],
  description: ["description", "beschreibung", "bemerkung", "notiz", "kommentar"],
  shipping_charged: ["shipping_charged", "shipping", "versand", "versandkosten"],
  shipping_cost: ["shipping_cost", "versandkosten_bezahlt", "eigene versandkosten"],
  advertising_fee: ["advertising_fee", "werbekosten", "anzeigenkosten", "werbegebühr", "werbegebuehr"],
  order_id: ["order_id", "order-id", "bestellnummer", "bestell-nr", "bestellnr", "auftragsnummer", "external_order_id"],
  sku: ["sku", "artikel-nr", "artikelnr", "artikelnummer"],
};

function col(key: string, required: boolean): ColumnSpec {
  return { key, aliases: ALIASES[key], required };
}

// ─── Formats ──────────────────────────────────────────────────────────────────

const RICH_COLUMNS: ColumnSpec[] = [
  col("order_id", true),
  col("date", true),
  col("product_name", true),
  col("quantity", true),
  col("total", true),
  col("unit_price", false),
  col("currency", false),
  col("vat_rate", false),
  col("vat_amount", false),
  col("shipping_charged", false),
  col("shipping_cost", false),
  col("advertising_fee", false),
  col("status", false),
  col("description", false),
  col("sku", false),
];

const RICH_HEADERS = ["order_id", "date", "product_name", "quantity", "total", "unit_price", "currency", "vat_rate", "vat_amount", "shipping_charged", "shipping_cost", "advertising_fee", "status", "description", "sku"];

export const IMPORT_FORMATS: Record<ImportFormatId, ImportFormat> = {
  generic: {
    id: "generic",
    label: "Generic (KaufNest template)",
    forcedPlatform: null,
    columns: [
      col("date", true),
      col("product_name", true),
      col("platform", false),
      col("quantity", true),
      col("unit_price", true),
      col("total", false),
      col("currency", false),
      col("vat_rate", false),
      col("status", false),
      col("description", false),
      col("shipping_cost", false),
      col("shipping_charged", false),
      col("advertising_fee", false),
      col("order_id", false),
      col("sku", false),
    ],
    templateHeaders: ["date", "product_name", "platform", "quantity", "unit_price", "currency", "vat_rate", "status", "description", "shipping_cost", "shipping_charged", "advertising_fee", "sku"],
    templateExample: ["2024-01-15", "Blue Widget", "amazon", "10", "9.99", "EUR", "19", "pending", "Sample sale", "", "", "", ""],
  },
  amazon: {
    id: "amazon",
    label: "Amazon sheet",
    forcedPlatform: "amazon",
    columns: RICH_COLUMNS,
    templateHeaders: RICH_HEADERS,
    // German conventions on purpose — advertises that "15.01.2024" / "19,98" work.
    templateExample: ["302-1234567-1234567", "15.01.2024", "Blue Widget", "2", "19,98", "", "EUR", "19", "3,80", "4,99", "3,20", "1,50", "shipped", "", "WIDGET-BLU"],
    vatRateIsFraction: true,
    priceColumnsAreLineTotals: true,
  },
  ebay: {
    id: "ebay",
    label: "eBay sheet",
    forcedPlatform: "ebay",
    columns: RICH_COLUMNS,
    templateHeaders: RICH_HEADERS,
    templateExample: ["12-34567-89012", "15.01.2024", "Blue Widget", "1", "24,99", "", "EUR", "19", "4,75", "5,99", "4,10", "0,80", "shipped", "Promoted Listings fee in advertising_fee", "WIDGET-BLU"],
  },
};

export const IMPORT_FORMAT_IDS: ImportFormatId[] = ["generic", "amazon", "ebay"];

// ─── Header resolution ────────────────────────────────────────────────────────

export interface HeaderResolution {
  /** raw header (lowercase) → canonical key. Unknown headers are absent (ignored). */
  mapping: Map<string, string>;
  /** Canonical keys of required columns not present in the file. */
  missingRequired: string[];
}

export function resolveHeaders(rawHeaders: string[], format: ImportFormat): HeaderResolution {
  const mapping = new Map<string, string>();
  for (const raw of rawHeaders) {
    const normalized = raw.trim().toLowerCase();
    const spec = format.columns.find((c) => c.aliases.includes(normalized));
    if (spec && ![...mapping.values()].includes(spec.key)) {
      mapping.set(raw, spec.key);
    }
  }
  const resolved = new Set(mapping.values());
  const missingRequired = format.columns
    .filter((c) => c.required && !resolved.has(c.key))
    .map((c) => c.key);
  return { mapping, missingRequired };
}

/** Re-key a parsed CSV row from raw headers to canonical column keys. */
export function canonicalizeRow(raw: Record<string, string>, mapping: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, key] of mapping) {
    out[key] = raw[rawKey] ?? "";
  }
  return out;
}

// ─── Platform normalization ───────────────────────────────────────────────────

/**
 * Normalize regional marketplace variants to the canonical Platform value.
 * "amazon.de", "amazon.nl", "amazon.co.uk" → "amazon"; "ebay.de" → "ebay".
 */
export function normalizePlatform(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("amazon")) return "amazon";
  if (s.startsWith("ebay")) return "ebay";
  return s;
}

// ─── Status normalization (I8) ────────────────────────────────────────────────

const STATUS_SYNONYMS: Record<string, string> = {
  offen: "pending",
  ausstehend: "pending",
  "in bearbeitung": "processing",
  versandt: "shipped",
  verschickt: "shipped",
  geliefert: "delivered",
  zugestellt: "delivered",
  retoure: "returned",
  "zurückgegeben": "returned",
  "rücksendung": "returned",
  storniert: "cancelled",
};

export function normalizeStatus(raw: string | undefined): string {
  const s = raw?.trim();
  if (!s) return "pending";
  return STATUS_SYNONYMS[s.toLowerCase()] ?? s;
}

// ─── Skip classification ──────────────────────────────────────────────────

export type SkipReason = "blank row" | "summary row" | "not a sale" | "unsupported currency";

/** Amazon row types that are not sales and carry no importable order. */
const NON_SALE_STATUSES = new Set(["refund", "fc_transfer"]);

/**
 * Classify a row that should be skipped rather than errored. Only applies to
 * formats whose sheets contain non-sale rows (currently `amazon`) — a real
 * Amazon VAT report is mostly returns, refunds, warehouse transfers, blank
 * filler rows and a trailing `Total` summary row. Erroring on those would make
 * the file impossible to import, since validation is all-or-nothing.
 *
 * RETURN is deliberately NOT skipped: it is handled as a return (Task 5).
 */
export function classifySkip(format: ImportFormat, raw: Record<string, string>): SkipReason | null {
  // The format guard MUST come first. Every skip reason below — including the
  // blank-row one — applies only to sheets that carry non-sale rows. Putting
  // the blank check above this line would make `generic` and `ebay` silently
  // skip blank rows instead of erroring, changing the behaviour of two formats
  // this task must leave exactly as they are.
  if (!format.priceColumnsAreLineTotals) return null;

  const values = Object.values(raw).map((v) => v?.trim() ?? "");
  if (values.every((v) => v === "")) return "blank row";

  // The trailing "Total" row puts its label in a column we do not map, and
  // scatters a couple of stray sums across unmapped columns — so it is neither
  // blank nor identifiable by order_id. Detect it structurally: every field a
  // real row must have is empty.
  const hasNoIdentity =
    !raw.date?.trim() && !raw.product_name?.trim() && !raw.quantity?.trim();
  if (hasNoIdentity) return "summary row";

  const status = raw.status?.trim().toLowerCase() ?? "";
  if (NON_SALE_STATUSES.has(status)) return "not a sale";

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
export function validateRowForFormat(
  format: ImportFormat,
  raw: Record<string, string>,
  rowNum: number,
): ParsedRow {
  const fail = (error: string): ParsedRow => ({ rowNum, data: null, error: `Row ${rowNum}: ${error}` });

  const skipReason = classifySkip(format, raw);
  if (skipReason) {
    return { rowNum, data: null, error: null, skipped: skipReason };
  }

  const date = parseFlexibleDate(raw.date);
  if (!date) {
    return fail(`invalid or missing "date" (expected YYYY-MM-DD, DD.MM.YYYY, or DD-MM-YYYY)`);
  }

  const productName = raw.product_name?.trim();
  if (!productName) {
    return fail(`missing "product_name"`);
  }

  let platform: Platform;
  if (format.forcedPlatform) {
    platform = format.forcedPlatform;
  } else {
    platform = normalizePlatform(raw.platform?.trim() || "other") as Platform;
    if (!VALID_PLATFORMS.includes(platform)) {
      return fail(`invalid "platform" "${raw.platform}" — use: ${VALID_PLATFORMS.join(", ")}`);
    }
  }

  const quantityNum = parseLocaleNumber(raw.quantity);
  if (quantityNum === null || !Number.isInteger(quantityNum) || quantityNum <= 0) {
    return fail(`"quantity" must be a positive integer`);
  }
  const quantity = quantityNum;

  const totalRaw = raw.total?.trim();
  const unitPriceRaw = raw.unit_price?.trim();
  const shippingChargedRaw = raw.shipping_charged?.trim();
  let totalAmount: number;
  let unitPrice: number;

  if (format.priceColumnsAreLineTotals) {
    // Amazon: `unit_price` is the item LINE total (VAT incl) and `total` is
    // items + shipping. `total_amount` must hold items only — aggregateSales
    // computes revenue as total_amount + shipping_charged.
    const ship = shippingChargedRaw ? (parseLocaleNumber(shippingChargedRaw) ?? 0) : 0;
    const sheetTotal = totalRaw ? parseLocaleNumber(totalRaw) : null;
    if (totalRaw && (sheetTotal === null || sheetTotal <= 0)) {
      return fail(`"total" must be a positive number`);
    }

    let itemTotal: number | null;
    if (unitPriceRaw) {
      itemTotal = parseLocaleNumber(unitPriceRaw);
    } else if (sheetTotal !== null) {
      // `unit_price` is OPTIONAL on this format. When it is absent the item
      // total must be BACKED OUT of the sheet total — `total` includes shipping,
      // so using it raw would store a shipping-inclusive figure in total_amount
      // and double-count shipping in revenue.
      itemTotal = round2(sheetTotal - ship);
    } else {
      itemTotal = null;
    }
    if (itemTotal === null || itemTotal <= 0) {
      return fail(`"unit_price" (item line total) or "total" must be a positive number`);
    }
    totalAmount = round2(itemTotal);
    unitPrice = round2(itemTotal / quantity);

    // Reconcile only when BOTH were supplied. When the item total was derived
    // from the sheet total the identity holds by construction.
    if (unitPriceRaw && sheetTotal !== null) {
      if (Math.abs(totalAmount + ship - sheetTotal) > 0.02) {
        return fail(
          `"total" (${round2(sheetTotal)}) does not reconcile with item total + shipping (${round2(totalAmount + ship)})`,
        );
      }
    }
  } else if (totalRaw) {
    // I4: `total` wins when present; unit_price derived when blank; both
    // present and inconsistent (> 0.02) → row error.
    const total = parseLocaleNumber(totalRaw);
    if (total === null || total <= 0) {
      return fail(`"total" must be a positive number`);
    }
    totalAmount = round2(total);
    if (unitPriceRaw) {
      const up = parseLocaleNumber(unitPriceRaw);
      if (up === null || up <= 0) {
        return fail(`"unit_price" must be a positive number`);
      }
      if (Math.abs(quantity * up - totalAmount) > 0.02) {
        return fail(`"total" (${totalAmount}) disagrees with quantity × unit_price (${round2(quantity * up)})`);
      }
      unitPrice = up;
    } else {
      unitPrice = round2(totalAmount / quantity);
    }
  } else {
    const up = parseLocaleNumber(unitPriceRaw);
    if (up === null || up <= 0) {
      return fail(`"unit_price" must be a positive number`);
    }
    unitPrice = up;
    totalAmount = round2(quantity * up);
  }

  const currency = (raw.currency?.trim().toUpperCase() || "EUR") as Currency;
  if (!VALID_CURRENCIES.includes(currency)) {
    return fail(`invalid "currency" "${raw.currency}" — use: ${VALID_CURRENCIES.join(", ")}`);
  }

  const vatRateRaw = raw.vat_rate?.trim();
  const parsedVatRate = vatRateRaw ? parseLocaleNumber(vatRateRaw) : null;
  // Amazon writes fractions (0.19). Scale BEFORE range-checking, so 0.19
  // becomes 19 rather than silently importing as a 0.19 % rate.
  const vatRate =
    parsedVatRate !== null && format.vatRateIsFraction
      ? round2(parsedVatRate * 100)
      : parsedVatRate;
  if (vatRateRaw && (vatRate === null || vatRate < 0 || vatRate > 100)) {
    return fail(`"vat_rate" must be between 0 and 100`);
  }

  // Amazon supplies the COMBINED item + shipping VAT. Deriving from a single
  // rate is wrong when the shipping VAT rate differs from the item rate —
  // which it does on the Swedish rows (25 %).
  const vatAmountRaw = raw.vat_amount?.trim();
  let vatAmount: number | null;
  if (vatAmountRaw) {
    const parsed = parseLocaleNumber(vatAmountRaw);
    if (parsed === null || parsed < 0) {
      return fail(`"vat_amount" must be a non-negative number`);
    }
    vatAmount = round2(parsed);
  } else {
    vatAmount = vatRate ? vatAmountFromGross(totalAmount, vatRate) : null;
  }

  const fee = (key: "shipping_cost" | "shipping_charged" | "advertising_fee"): { value: number | null; error?: string } => {
    const s = raw[key]?.trim();
    if (!s) return { value: null };
    const n = parseLocaleNumber(s);
    if (n === null || n < 0) return { value: null, error: `"${key}" must be a non-negative number` };
    return { value: n };
  };
  const shippingCost = fee("shipping_cost");
  if (shippingCost.error) return fail(shippingCost.error);
  const shippingCharged = fee("shipping_charged");
  if (shippingCharged.error) return fail(shippingCharged.error);
  const advertisingFee = fee("advertising_fee");
  if (advertisingFee.error) return fail(advertisingFee.error);

  const externalOrderId = raw.order_id?.trim() || null;
  if (!externalOrderId && format.columns.some((c) => c.key === "order_id" && c.required)) {
    return fail(`missing "order_id"`);
  }

  return {
    rowNum,
    data: {
      platform,
      product_name: productName,
      quantity,
      unit_price: unitPrice,
      total_amount: totalAmount,
      currency,
      date,
      description: raw.description?.trim() || null,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      shipping_cost: shippingCost.value,
      shipping_charged: shippingCharged.value,
      advertising_fee: advertisingFee.value,
      status: normalizeStatus(raw.status),
      restock: false,
      external_order_id: externalOrderId,
    },
    error: null,
    sku: raw.sku?.trim() || null,
  };
}
