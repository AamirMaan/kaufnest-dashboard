/**
 * Shared header vocabulary for the CSV importers (Sales, Expenses).
 *
 * German and multilingual spreadsheets name the same column a dozen ways.
 * This is the single bank of those names; each feature's format registry
 * composes the ones its columns actually use. Keeping it here stops Sales
 * and Expenses drifting into two half-maintained copies.
 *
 * Pure module — no React/Supabase/Redux.
 */

export interface ColumnSpec {
  key: string;
  aliases: string[];
  required: boolean;
}

export interface HeaderResolution {
  mapping: Map<string, string>;
  missingRequired: string[];
}

/**
 * Lowercase, trim, and drop a TRAILING parenthesised unit.
 *
 * Real exports label money columns "Gross Amount (€)" and rates "VAT Rate (%)".
 * The € is routinely mojibaked to "â¬" when Excel writes windows-1252, so
 * matching the unit itself is fragile — dropping it is encoding-proof. Only a
 * trailing group is removed, so "Fee (net) total" keeps its parenthesis.
 */
export function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export const ALIASES: Record<string, string[]> = {
  // — shared —
  date: ["date", "datum", "bestelldatum", "verkaufsdatum", "rechnungsdatum", "belegdatum"],
  currency: ["currency", "währung", "waehrung"],
  description: ["description", "beschreibung", "bemerkung", "notiz", "kommentar"],
  vat_rate: ["vat_rate", "vat rate", "vat", "mwst", "mwst-satz", "mwst.", "ust", "ust-satz", "steuersatz"],
  vat_amount: ["vat_amount", "vat amount", "vat_betrag", "mwst_betrag", "mwstbetrag", "steuerbetrag"],

  // — sales —
  product_name: ["product_name", "product", "artikel", "artikelname", "artikelbezeichnung", "titel", "produktname", "produkt"],
  platform: ["platform", "plattform"],
  quantity: ["quantity", "qty", "menge", "anzahl", "stück", "stueck", "stk"],
  unit_price: ["unit_price", "price", "preis", "stückpreis", "stueckpreis", "einzelpreis"],
  // "Versandkosten" on an order sheet means what the buyer paid → shipping_charged (I6).
  total: ["total", "total_amount", "gesamt", "gesamtbetrag", "gesamtpreis", "brutto", "verkaufsbetrag", "summe"],
  status: ["status", "bestellstatus"],
  shipping_charged: ["shipping_charged", "shipping", "versand", "versandkosten"],
  shipping_cost: ["shipping_cost", "versandkosten_bezahlt", "eigene versandkosten"],
  advertising_fee: ["advertising_fee", "werbekosten", "anzeigenkosten", "werbegebühr", "werbegebuehr"],
  platform_fee: ["platform_fee", "plattformgebühr", "plattformgebuehr", "verkaufsprovision", "vermittlungsgebühr", "vermittlungsgebuehr"],
  order_id: ["order_id", "order-id", "bestellnummer", "bestell-nr", "bestellnr", "auftragsnummer", "external_order_id"],
  sku: ["sku", "artikel-nr", "artikelnr", "artikelnummer"],

  // — expenses —
  title: ["title", "titel", "bezeichnung", "verwendungszweck"],
  amount: ["amount", "betrag", "brutto", "bruttobetrag", "gross", "gross amount"],
  net_amount: ["net_amount", "net amount", "netto", "nettobetrag"],
  vendor: ["vendor", "supplier", "lieferant", "händler", "haendler", "anbieter"],
  category: ["category", "kategorie"],
  invoice_number: ["invoice_number", "invoice number", "rechnungsnummer", "rechnungs-nr", "rechnungsnr", "belegnummer"],
  vendor_vat_number: ["vendor_vat_number", "ustid des anbieters", "ustid", "ust-id", "umsatzsteuer-id", "vat id", "vat-id"],
  /**
   * Deliberately NOT folded into vendor_vat_number. The ledger has BOTH
   * columns and fills whichever identifier a vendor has — the fuel-station
   * rows carry only a Steuernummer. `resolveHeaders` maps one header per key,
   * so folding them would silently drop the second column for every row.
   * They are merged per ROW in the expense validator instead.
   */
  tax_number: ["tax_number", "steuernummer", "steuer-nr"],
};

/**
 * Map each sheet header onto a column key, first header to claim a key wins.
 *
 * TWO PASSES, and the order is load-bearing. `normalizeHeader` strips a
 * trailing parenthesised unit so "Gross Amount (€)" can match the alias
 * "gross amount" — but that same strip lets a header claim a key it does not
 * actually name. A Sales sheet with "Total (net)" appearing BEFORE "Total"
 * normalises the first to "total", which claims the `total` key, and the real
 * "Total" column is then dropped by the first-wins guard.
 *
 * So: pass 1 matches only the raw lowercased-and-trimmed name, letting any
 * header that spells an alias exactly take its key. Pass 2 then offers the
 * normalised name for whatever is still unclaimed, which is what keeps the
 * "(€)" / "(%)" unit suffixes working. An exact match always beats a
 * normalised one regardless of column order in the sheet.
 */
export function resolveHeaders(rawHeaders: string[], columns: ColumnSpec[]): HeaderResolution {
  const mapping = new Map<string, string>();
  const claimed = new Set<string>();

  const claim = (raw: string, candidate: string) => {
    if (mapping.has(raw)) return;
    const spec = columns.find((c) => c.aliases.includes(candidate));
    if (spec && !claimed.has(spec.key)) {
      mapping.set(raw, spec.key);
      claimed.add(spec.key);
    }
  };

  for (const raw of rawHeaders) claim(raw, raw.trim().toLowerCase());
  for (const raw of rawHeaders) claim(raw, normalizeHeader(raw));

  const missingRequired = columns
    .filter((c) => c.required && !claimed.has(c.key))
    .map((c) => c.key);
  return { mapping, missingRequired };
}

export function canonicalizeRow(
  raw: Record<string, string>,
  mapping: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, key] of mapping) {
    out[key] = raw[rawKey] ?? "";
  }
  return out;
}
