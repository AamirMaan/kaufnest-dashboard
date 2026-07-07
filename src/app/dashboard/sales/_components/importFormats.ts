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
  col("shipping_charged", false),
  col("shipping_cost", false),
  col("advertising_fee", false),
  col("status", false),
  col("description", false),
  col("sku", false),
];

const RICH_HEADERS = ["order_id", "date", "product_name", "quantity", "total", "unit_price", "currency", "vat_rate", "shipping_charged", "shipping_cost", "advertising_fee", "status", "description", "sku"];

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
    templateExample: ["302-1234567-1234567", "15.01.2024", "Blue Widget", "2", "19,98", "", "EUR", "19", "4,99", "3,20", "1,50", "shipped", "", "WIDGET-BLU"],
  },
  ebay: {
    id: "ebay",
    label: "eBay sheet",
    forcedPlatform: "ebay",
    columns: RICH_COLUMNS,
    templateHeaders: RICH_HEADERS,
    templateExample: ["12-34567-89012", "15.01.2024", "Blue Widget", "1", "24,99", "", "EUR", "19", "5,99", "4,10", "0,80", "shipped", "Promoted Listings fee in advertising_fee", "WIDGET-BLU"],
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

  // I4: `total` wins when present; unit_price derived when blank; both present
  // and inconsistent (> 0.02) → row error.
  const totalRaw = raw.total?.trim();
  const unitPriceRaw = raw.unit_price?.trim();
  let totalAmount: number;
  let unitPrice: number;
  if (totalRaw) {
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
  const vatRate = vatRateRaw ? parseLocaleNumber(vatRateRaw) : null;
  if (vatRateRaw && (vatRate === null || vatRate < 0 || vatRate > 100)) {
    return fail(`"vat_rate" must be between 0 and 100`);
  }
  const vatAmount = vatRate ? vatAmountFromGross(totalAmount, vatRate) : null;

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
