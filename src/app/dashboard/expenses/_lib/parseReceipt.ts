import type { Currency, ExpenseCategory } from "@/types";

/**
 * Fields a receipt's text can suggest for an expense. Every field is
 * optional — the parser only returns what it found with reasonable
 * confidence, and the form fills only fields that are still empty.
 * Title is deliberately never suggested (spec: the user's own naming stays
 * explicit).
 */
export interface ParsedReceipt {
  date?: string; // ISO yyyy-mm-dd
  amount?: number; // gross total, may be negative (credit note)
  currency?: Currency;
  vatRate?: number; // percent, e.g. 19
  vatAmount?: number;
  vendorVatNumber?: string;
  invoiceNumber?: string;
  vendor?: string;
  category?: ExpenseCategory;
}

export interface ParseReceiptOptions {
  /** ISO date treated as "today" — dates more than a day after it are rejected. Defaults to the real today. */
  today?: string;
}

// ─── Amounts ──────────────────────────────────────────────────────────────────

// A money amount always has exactly two decimals on a receipt. The
// lookarounds stop a date like 12.03.2026 from yielding "12.03", and stop a
// match starting mid-number.
const AMOUNT_RE = /(?<![\d.,])-?\d{1,3}(?:[.,' ]\d{3})*[.,]\d{2}(?![.,]?\d)|(?<![\d.,])-?\d+[.,]\d{2}(?![.,]?\d)/g;

/** "1.234,56" / "1,234.56" / "1234,56" / "-12.00" → number. The LAST separator is the decimal point. */
export function toNumber(raw: string): number {
  const s = raw.replace(/\s|'/g, "");
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const intPart = s.slice(0, last).replace(/[.,]/g, "");
  return Number(`${intPart}.${s.slice(last + 1)}`);
}

function amountsIn(line: string): number[] {
  return Array.from(line.matchAll(AMOUNT_RE), (m) => toNumber(m[0]));
}

const TOTAL_RE =
  /\b(gesamtbetrag|gesamtsumme|gesamt|summe|endbetrag|rechnungsbetrag|zu zahlen|zahlbetrag|total|amount due|balance due|betrag)\b/i;
const NOT_TOTAL_RE = /(zwischensumme|sub-?total|netto|\bnet\b|mwst|\bust\b|vat|steuer|\btax\b)/i;

function largestByMagnitude(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
}

function findTotal(lines: string[]): { amount: number; line: number } | undefined {
  const candidates: { amount: number; line: number }[] = [];
  lines.forEach((line, i) => {
    if (!TOTAL_RE.test(line) || NOT_TOTAL_RE.test(line)) return;
    // PDF text and OCR often put the figure on the line after its label.
    const onLine = amountsIn(line);
    const values = onLine.length > 0 ? onLine : amountsIn(lines[i + 1] ?? "");
    const amount = largestByMagnitude(values);
    if (amount !== undefined) candidates.push({ amount, line: onLine.length > 0 ? i : i + 1 });
  });
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
  }
  let best: { amount: number; line: number } | undefined;
  lines.forEach((line, i) => {
    const amount = largestByMagnitude(amountsIn(line));
    if (amount !== undefined && (!best || Math.abs(amount) > Math.abs(best.amount))) best = { amount, line: i };
  });
  return best;
}

// ─── Currency ─────────────────────────────────────────────────────────────────

const CURRENCY_PATTERNS: [Currency, RegExp][] = [
  ["EUR", /€|\bEUR\b/g],
  ["GBP", /£|\bGBP\b/g],
  ["USD", /\$|\bUSD\b/g],
];

function findCurrency(lines: string[], totalLine: number | undefined): Currency | undefined {
  if (totalLine !== undefined) {
    const near = [lines[totalLine - 1], lines[totalLine], lines[totalLine + 1]].join(" ");
    for (const [code, re] of CURRENCY_PATTERNS) if (new RegExp(re.source).test(near)) return code;
  }
  const text = lines.join("\n");
  let best: Currency | undefined;
  let bestCount = 0;
  for (const [code, re] of CURRENCY_PATTERNS) {
    const count = (text.match(re) ?? []).length;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

// ─── VAT ──────────────────────────────────────────────────────────────────────

const VAT_LINE_RE = /(mwst|\bust\b|umsatzsteuer|mehrwertsteuer|\bvat\b)/i;
const RATE_RE = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/;
const KNOWN_RATES = [0, 5, 7, 10, 16, 19, 20, 21, 22, 23, 25];
const VAT_TOLERANCE = 0.02;

/** VAT contained in a gross amount at `rate` percent. */
function vatInGross(gross: number, rate: number): number {
  return (gross * rate) / (100 + rate);
}

function findVat(lines: string[], total: number | undefined): { rate?: number; amount?: number } {
  const rates = new Set<number>();
  let amount: number | undefined;
  for (const line of lines) {
    if (!VAT_LINE_RE.test(line)) continue;
    const rateMatch = RATE_RE.exec(line);
    const rate = rateMatch ? Number(rateMatch[1].replace(",", ".")) : undefined;
    if (rate !== undefined && rate > 0 && rate <= 30) rates.add(rate);
    // Drop the rate's own digits before reading amounts off the line.
    const values = amountsIn(rateMatch ? line.replace(rateMatch[0], " ") : line);
    if (values.length === 0) continue;
    const checked =
      total !== undefined && rate !== undefined
        ? values.find((v) => Math.abs(v - vatInGross(total, rate)) <= VAT_TOLERANCE)
        : undefined;
    amount ??= checked ?? values.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  }
  // Mixed rates (7% + 19% on one supermarket bill) can't be represented by
  // the form's single rate — suggest nothing rather than something wrong.
  if (rates.size > 1) return {};
  let rate = rates.size === 1 ? [...rates][0] : undefined;
  if (rate === undefined && amount !== undefined && total !== undefined && total !== amount) {
    const derived = (amount * 100) / (total - amount);
    rate = KNOWN_RATES.find((r) => Math.abs(r - derived) <= 0.3);
  }
  return { rate, amount };
}

// ─── Identifiers ──────────────────────────────────────────────────────────────

const VAT_ID_RE =
  /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI|GB) ?([0-9A-Z]{8,12})\b/g;
const VAT_ID_LABEL_RE = /(ust-?id|ust\.?-?idnr|umsatzsteuer-?id|vat\s*(no|number|id|reg)|\buid\b|tax id)/i;
const BANK_LINE_RE = /(iban|bic|swift|konto|bank)/i;

function findVatNumber(lines: string[]): string | undefined {
  let fallback: string | undefined;
  for (const line of lines) {
    if (BANK_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(VAT_ID_RE)) {
      if ((m[2].match(/\d/g) ?? []).length < 7) continue;
      const id = `${m[1]}${m[2]}`;
      if (VAT_ID_LABEL_RE.test(line)) return id;
      fallback ??= id;
    }
  }
  return fallback;
}

const INVOICE_RE =
  /(rechnungs?-?\s?(?:nummer|nr\.?)|rechnung\s+nr\.?|beleg-?\s?(?:nummer|nr\.?)|bon-?\s?nr\.?|invoice\s*(?:no\.?|number|#))\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{2,})/i;

function findInvoiceNumber(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = INVOICE_RE.exec(line);
    if (m && /\d/.test(m[2])) return m[2].replace(/[.]+$/, "");
  }
  return undefined;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, märz: 3, maerz: 3, mar: 3, march: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11,
  dez: 12, dezember: 12, dec: 12, december: 12,
};
const DATE_LABEL_RE = /(rechnungsdatum|belegdatum|datum|invoice date|\bdate\b)/i;

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

function datesIn(line: string): string[] {
  const found: string[] = [];
  for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const d = iso(+m[1], +m[2], +m[3]);
    if (d) found.push(d);
  }
  for (const m of line.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)) {
    const d = iso(+m[3], +m[2], +m[1]) ?? iso(+m[3], +m[1], +m[2]);
    if (d) found.push(d);
  }
  for (const m of line.matchAll(/\b(\d{1,2})\.?\s+([A-Za-zäÄ]{3,9})\.?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[2].toLowerCase()];
    const d = month ? iso(+m[3], month, +m[1]) : undefined;
    if (d) found.push(d);
  }
  for (const m of line.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1].toLowerCase()];
    const d = month ? iso(+m[3], month, +m[2]) : undefined;
    if (d) found.push(d);
  }
  return found;
}

function findDate(lines: string[], today: string): string | undefined {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 1);
  const max = limit.toISOString().slice(0, 10);
  const ok = (d: string) => d >= "2000-01-01" && d <= max;
  let first: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const labelled = DATE_LABEL_RE.test(lines[i]);
    const candidates = [...datesIn(lines[i]), ...(labelled ? datesIn(lines[i + 1] ?? "") : [])].filter(ok);
    if (labelled && candidates.length > 0) return candidates[0];
    first ??= candidates[0];
  }
  return first;
}

// ─── Vendor & category ────────────────────────────────────────────────────────

const COMPANY_RE = /\b(gmbh|ag|ug|kg|ohg|e\.\s?k\.|ltd|limited|inc|llc|plc|s\.a\.|b\.v\.|se)\b/i;
const NOT_VENDOR_RE =
  /(rechnung|invoice|receipt|quittung|kassenbon|beleg|datum|date|tel|fax|www\.|http|@|str\.|straße|strasse|street|road|\b\d{5}\b|seite|page|kunde|customer)/i;

function findVendor(lines: string[]): string | undefined {
  const head = lines.slice(0, 10).map((l) => l.trim()).filter(Boolean);
  const company = head.find((l) => COMPANY_RE.test(l) && !/@|www\.|http/i.test(l));
  if (company) return company.slice(0, 60);
  const plain = head
    .slice(0, 5)
    .find((l) => !NOT_VENDOR_RE.test(l) && !/^\d/.test(l) && (l.match(/[A-Za-zÄÖÜäöüß]/g) ?? []).length >= 3);
  return plain?.slice(0, 60);
}

const CATEGORY_KEYWORDS: [ExpenseCategory, RegExp][] = [
  ["shipping", /\b(dhl|dpd|hermes|ups|gls|fedex|deutsche post|royal mail|evri|parcelforce|usps)\b/i],
  ["advertising", /\b(google ads|facebook ads|meta ads|amazon ads|microsoft advertising)\b/i],
  ["software", /\b(shopify|adobe|microsoft 365|google workspace|dropbox|canva|github|notion|slack)\b/i],
];

function findCategory(text: string): ExpenseCategory | undefined {
  return CATEGORY_KEYWORDS.find(([, re]) => re.test(text))?.[0];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Rule-based extraction of expense fields from a receipt's plain text (PDF
 * text layer or OCR output). German and English. Pure — no browser APIs —
 * so it is fully unit-tested; `extractReceiptText.ts` produces its input.
 */
export function parseReceipt(text: string, options: ParseReceiptOptions = {}): ParsedReceipt {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());

  const total = findTotal(lines);
  const vat = findVat(lines, total?.amount);
  const result: ParsedReceipt = {
    date: findDate(lines, today),
    amount: total?.amount,
    currency: findCurrency(lines, total?.line),
    vatRate: vat.rate,
    vatAmount: vat.amount,
    vendorVatNumber: findVatNumber(lines),
    invoiceNumber: findInvoiceNumber(lines),
    vendor: findVendor(lines),
    category: findCategory(text),
  };
  for (const key of Object.keys(result) as (keyof ParsedReceipt)[]) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}
