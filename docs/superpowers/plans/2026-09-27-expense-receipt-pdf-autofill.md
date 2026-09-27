# Expense Receipts: PDF Support + Non-AI Autofill Implementation Plan (Part 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let expense receipts be PDFs as well as images, and add a "Fill from receipt" button that reads a receipt in the browser, without AI, and fills the expense form's empty fields.

**Architecture:** Two pure, fully tested modules carry the logic.
- `parseReceipt(text)` turns receipt text into suggested fields, using German/English rules.
- `applyReceiptToForm(form, parsed, baseline)` merges those suggestions without overwriting anything the user typed.

A browser-only `extractReceiptText(blob, mime)` produces the text:
- `pdfjs-dist` reads the text layer of PDFs;
- `tesseract.js` OCRs photos and scanned PDFs (page 1 only);
- both are imported dynamically when the button is clicked, so neither ships in the main bundle.

A `useReceiptAutofill` hook ties download → extract → parse → merge together for both expense modals.

**Tech Stack:** Next.js 16 (Turbopack) App Router, React 19, Supabase Storage (private `expense-receipts` bucket), `pdfjs-dist` 6.x, `tesseract.js` 7.x, Jest (`testEnvironment: node`), Tailwind with `var(--color-*)` tokens.

**Spec:** `docs/superpowers/specs/2026-09-26-summary-tiles-receipt-autofill-overview-charts-design.md` → "Part 2".

## Global Constraints

- Work only in the worktree `.worktrees/feat-expense-receipt-pdf-autofill`, on branch `feat/expense-receipt-pdf-autofill`. Run every command from that directory.
- **No AI and no server round-trip for reading receipts.** The file is downloaded from Storage to the browser and read there. The only network calls are the Storage download and the pdf.js/tesseract worker, core and language files, which come from the jsdelivr CDN.
- **No database migration.** The `expense-receipts` bucket (046) sets no `allowed_mime_types`, so PDFs already upload.
- The 15 MB per-file cap is unchanged. Accepted types are `image/*` and `application/pdf` only.
- **Autofill never overwrites user input.** It only fills a field that is blank, or that still holds the Add modal's untouched default (today's date, `EUR`, category `other`). The VAT pair only fills while "Amount includes VAT" is unticked.
- **Title is never auto-filled.**
- Only a single VAT rate is suggested. A receipt with mixed rates suggests no rate.
- OCR languages are `deu+eng`. Only page 1 of a scanned PDF is OCR'd.
- `pdfjs-dist` and `tesseract.js` are only ever loaded with a dynamic `import()` inside the click path, never a top-level import, so they stay out of the main bundle.
- UI follows AGENTS.md:
  - every action toasts on success and on failure;
  - busy states swap the label ("Reading…") and show `<Loader2 className="animate-spin" />`;
  - icon-only buttons carry an `aria-label`;
  - colours come from tokens only.
- Receipt paths are always passed through `pathFromStoredReceipt(receipt, tenantSchema)` before any Storage call. That is the existing tenant-prefix defence.
- Do not run `npx tsc --noEmit` or `npm run lint` manually; the pre-commit hook runs them. Run focused tests with `npx jest <path>`.
- Every commit that changes the feature also updates `src/app/dashboard/expenses/CLAUDE.md`/`SKILL.md` (and `src/components/ui/SKILL.md` when an atom changes) in the same commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/app/dashboard/expenses/_lib/parseReceipt.ts` (+ `.test.ts`) | create | receipt text → `ParsedReceipt` (pure) |
| `src/app/dashboard/expenses/_lib/applyReceiptToForm.ts` (+ `.test.ts`) | create | merge `ParsedReceipt` into form state without overwriting (pure) |
| `src/app/dashboard/expenses/_lib/receiptFileType.ts` (+ `.test.ts`) | create | accepted-type rule, `isPdfReceipt` (pure) |
| `src/app/dashboard/expenses/_lib/extractReceiptText.ts` (+ `.test.ts` for its pure helper) | create | Blob → text via pdf.js / tesseract (browser only) |
| `src/app/dashboard/expenses/_components/useReceiptAutofill.ts` | create | hook: download → extract → parse → merge, toasts, highlight state |
| `src/app/dashboard/expenses/_components/ReceiptUploader.tsx` | modify | accept PDFs, PDF tile, open-in-new-tab, per-receipt "Fill" button |
| `src/app/dashboard/expenses/_components/AddExpenseModal.tsx` | modify | wire the hook; highlight filled fields |
| `src/app/dashboard/expenses/_components/EditExpenseModal.tsx` | modify | wire the hook; highlight filled fields |
| `src/components/ui/FormFields.tsx` | modify | `Input`/`Select`/`Textarea` merge a passed `className` instead of replacing the base class |
| `package.json` / `package-lock.json` | modify | + `pdfjs-dist`, `tesseract.js` |
| docs: `expenses/CLAUDE.md`, `expenses/SKILL.md`, `src/components/ui/SKILL.md` | modify | file map, gotchas |

---

### Task 1: `parseReceipt`, the pure receipt-text parser

**Files:**
- Create: `src/app/dashboard/expenses/_lib/parseReceipt.ts`
- Create: `src/app/dashboard/expenses/_lib/parseReceipt.test.ts`
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`

**Interfaces:**
- Produces: `ParsedReceipt` (all fields optional: `date?: string` ISO, `amount?: number`, `currency?: Currency`, `vatRate?: number`, `vatAmount?: number`, `vendorVatNumber?: string`, `invoiceNumber?: string`, `vendor?: string`, `category?: ExpenseCategory`). Also `parseReceipt(text: string, options?: { today?: string }): ParsedReceipt` and `toNumber(raw: string): number`. A key that wasn't found is absent, never `undefined`-valued.

- [ ] **Step 1: Write the failing test.** Create `src/app/dashboard/expenses/_lib/parseReceipt.test.ts` with exactly:

```ts
import { parseReceipt, toNumber } from "./parseReceipt";

const TODAY = "2026-09-27";
const parse = (text: string) => parseReceipt(text, { today: TODAY });

describe("toNumber", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1234,56", 1234.56],
    ["-12.00", -12],
    ["1 234,56", 1234.56],
  ])("%s → %d", (raw, expected) => {
    expect(toNumber(raw)).toBe(expected);
  });
});

describe("parseReceipt", () => {
  it("reads a German invoice (Rechnung)", () => {
    const text = [
      "Verpackungsprofi GmbH",
      "Industriestraße 12, 10115 Berlin",
      "USt-IdNr.: DE123456789",
      "Rechnung",
      "Rechnungsnummer: RE-2026-0042",
      "Rechnungsdatum: 14.09.2026",
      "Luftpolsterfolie 3 x 12,50 37,50",
      "Zwischensumme 37,50",
      "zzgl. MwSt 19% 7,13",
      "Gesamtbetrag 44,63 €",
      "IBAN DE89 3704 0044 0532 0130 00",
    ].join("\n");
    expect(parse(text)).toEqual({
      date: "2026-09-14",
      amount: 44.63,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 7.13,
      vendorVatNumber: "DE123456789",
      invoiceNumber: "RE-2026-0042",
      vendor: "Verpackungsprofi GmbH",
    });
  });

  it("reads an English invoice with thousands separators", () => {
    const text = [
      "Acme Supplies Ltd",
      "Invoice No: INV-10077",
      "Invoice date: 3 September 2026",
      "VAT No: GB123456789",
      "Subtotal £1,000.00",
      "VAT 20% £200.00",
      "Total due £1,200.00",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      date: "2026-09-03",
      amount: 1200,
      currency: "GBP",
      vatRate: 20,
      vatAmount: 200,
      vendorVatNumber: "GB123456789",
      invoiceNumber: "INV-10077",
      vendor: "Acme Supplies Ltd",
    });
  });

  it("reads a DHL receipt and suggests the shipping category", () => {
    const text = [
      "Deutsche Post DHL",
      "Filiale 123",
      "Datum 02.09.26 14:31",
      "DHL Paket 2kg 6,99",
      "Summe EUR 6,99",
      "enth. MwSt 19% 1,12",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      date: "2026-09-02",
      amount: 6.99,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 1.12,
      category: "shipping",
    });
  });

  it("puts a total on the next line when the label stands alone (PDF columns)", () => {
    const text = ["Muster Shop", "Gesamt", "129,90 EUR", "Datum: 2026-08-30"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 129.9, currency: "EUR", date: "2026-08-30" });
  });

  it("suggests no VAT rate for a supermarket bill with mixed rates", () => {
    const text = [
      "REWE Markt GmbH",
      "Summe EUR 23,47",
      "MwSt A 19% 1,90",
      "MwSt B 7% 1,01",
      "Datum 21.09.2026",
    ].join("\n");
    const parsed = parse(text);
    expect(parsed).toMatchObject({ amount: 23.47, currency: "EUR", date: "2026-09-21" });
    expect(parsed.vatRate).toBeUndefined();
    expect(parsed.vatAmount).toBeUndefined();
  });

  it("derives the VAT rate from the VAT amount when no percentage is printed", () => {
    const text = ["Shop", "Umsatzsteuer 3,19", "Total 19,99 €"].join("\n");
    expect(parse(text)).toMatchObject({ amount: 19.99, vatAmount: 3.19, vatRate: 19 });
  });

  it("keeps a credit note's negative total", () => {
    const text = ["Gutschrift", "Erstattung Verkäufergebühren", "Gesamtbetrag -123,81 EUR"].join("\n");
    expect(parse(text)).toMatchObject({ amount: -123.81, currency: "EUR" });
  });

  it("handles a receipt with no VAT at all", () => {
    const text = ["Kleinunternehmer Max Mustermann", "Betrag 50,00 €", "Gemäß §19 UStG keine Umsatzsteuer"].join("\n");
    const parsed = parse(text);
    expect(parsed).toMatchObject({ amount: 50, currency: "EUR" });
    expect(parsed.vatRate).toBeUndefined();
  });

  it("does not read a date or an IBAN as an amount or VAT number", () => {
    const text = [
      "Datum 12.03.2026",
      "IBAN DE89370400440532013000",
      "Konto DE12 3456 7890 1234",
      "Total 45,00 EUR",
    ].join("\n");
    const parsed = parse(text);
    expect(parsed.amount).toBe(45);
    expect(parsed.date).toBe("2026-03-12");
    expect(parsed.vendorVatNumber).toBeUndefined();
  });

  it("tolerates noisy OCR text", () => {
    const text = [
      "  Bürobedarf  Schmidt  e.K. ",
      "Beleg-Nr. 000481",
      "~~ 12.09.2026  09:14 ~~",
      "Druckerpapier   A4    8,49",
      "Toner           54,90",
      "SUMME    EUR    63,39",
      "MwSt  19,00 %   10,12",
    ].join("\n");
    expect(parse(text)).toMatchObject({
      amount: 63.39,
      currency: "EUR",
      vatRate: 19,
      vatAmount: 10.12,
      invoiceNumber: "000481",
      date: "2026-09-12",
      vendor: "Bürobedarf Schmidt e.K.",
    });
  });

  it("reads a US dollar receipt", () => {
    const text = ["Canva Pty Ltd", "Receipt #2231-7788", "Date: Sep 5, 2026", "Total $14.99 USD"].join("\n");
    expect(parse(text)).toMatchObject({
      amount: 14.99,
      currency: "USD",
      date: "2026-09-05",
      vendor: "Canva Pty Ltd",
      category: "software",
    });
  });

  it("rejects dates in the future", () => {
    const text = ["Lieferdatum 01.01.2030", "Datum 20.09.2026", "Summe 10,00 €"].join("\n");
    expect(parse(text).date).toBe("2026-09-20");
  });

  it("returns an empty object for text with nothing recognisable", () => {
    expect(parse("hello world")).toEqual({ vendor: "hello world" });
    expect(parse("")).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx jest dashboard/expenses/_lib/parseReceipt`
Expected: FAIL (`Cannot find module './parseReceipt'`).

- [ ] **Step 3: Implement.** Create `src/app/dashboard/expenses/_lib/parseReceipt.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest dashboard/expenses/_lib/parseReceipt`
Expected: PASS, 18 tests.

- [ ] **Step 5: Docs.**
  - `expenses/CLAUDE.md` file map: add `_lib/parseReceipt.ts` (+ test), described as "pure, rule-based receipt text → suggested expense fields (German/English); input comes from `extractReceiptText`".
  - `expenses/SKILL.md`, a minimal-file-set entry: "Improve receipt field detection → `_lib/parseReceipt.ts` + add a fixture to its test (every rule change gets a fixture)".
  - `expenses/SKILL.md`, gotchas:
    - amounts must have exactly 2 decimals, and the lookarounds in `AMOUNT_RE` are what stop dates being read as amounts;
    - mixed VAT rates deliberately suggest no rate;
    - Title is never suggested.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/expenses/_lib/parseReceipt.ts src/app/dashboard/expenses/_lib/parseReceipt.test.ts \
  src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "feat(expenses): rule-based receipt text parser (German/English)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `applyReceiptToForm`, the non-overwriting merge

**Files:**
- Create: `src/app/dashboard/expenses/_lib/applyReceiptToForm.ts`
- Create: `src/app/dashboard/expenses/_lib/applyReceiptToForm.test.ts`
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`

**Interfaces:**
- Consumes: `ParsedReceipt` (Task 1).
- Produces:
  - `ReceiptFillableForm` = `{ amount: string; currency: Currency; category: ExpenseCategory; vendor: string; date: string; vat_included: boolean; vat_rate: string; vendor_vat_number: string; invoice_number: string }`.
  - `ReceiptField = keyof ReceiptFillableForm`.
  - `ReceiptFillBaseline = Partial<Pick<ReceiptFillableForm, "currency" | "category" | "date">>`.
  - `applyReceiptToForm<F extends ReceiptFillableForm>(form: F, parsed: ParsedReceipt, baseline: ReceiptFillBaseline): { form: F; filled: ReceiptField[] }`.
  - Both modals' `FormState` already structurally satisfy `ReceiptFillableForm`.

- [ ] **Step 1: Write the failing test.** Create `src/app/dashboard/expenses/_lib/applyReceiptToForm.test.ts` with exactly:

```ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest dashboard/expenses/_lib/applyReceiptToForm`
Expected: FAIL (`Cannot find module './applyReceiptToForm'`).

- [ ] **Step 3: Implement.** Create `src/app/dashboard/expenses/_lib/applyReceiptToForm.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest dashboard/expenses/_lib/applyReceiptToForm`
Expected: PASS, 7 tests.

- [ ] **Step 5: Docs.**
  - `expenses/CLAUDE.md` file map: add `_lib/applyReceiptToForm.ts` (+ test).
  - `expenses/SKILL.md` gotcha: "Autofill never overwrites user input. The Add modal passes its defaults as the `baseline` (so today/EUR/other can be replaced); the Edit modal passes `{}` (so only blank fields fill). The VAT pair fills only while 'Amount includes VAT' is unticked."

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/expenses/_lib/applyReceiptToForm.ts src/app/dashboard/expenses/_lib/applyReceiptToForm.test.ts \
  src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "feat(expenses): merge parsed receipt into the expense form without overwriting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: PDF receipts, accepted and opened in a new tab

**Files:**
- Create: `src/app/dashboard/expenses/_lib/receiptFileType.ts`, `receiptFileType.test.ts`
- Modify: `src/app/dashboard/expenses/_components/ReceiptUploader.tsx`
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`

**Interfaces:**
- Produces: `RECEIPT_ACCEPT = "image/*,application/pdf"`, `isAcceptedReceiptType(mime: string): boolean`, `isPdfReceipt(receipt: { mime: string }): boolean`.

- [ ] **Step 1: Write the failing test** `src/app/dashboard/expenses/_lib/receiptFileType.test.ts`:

```ts
import { RECEIPT_ACCEPT, isAcceptedReceiptType, isPdfReceipt } from "./receiptFileType";

describe("receiptFileType", () => {
  it("accepts images and PDFs only", () => {
    expect(isAcceptedReceiptType("image/jpeg")).toBe(true);
    expect(isAcceptedReceiptType("image/heic")).toBe(true);
    expect(isAcceptedReceiptType("application/pdf")).toBe(true);
    expect(isAcceptedReceiptType("application/zip")).toBe(false);
    expect(isAcceptedReceiptType("")).toBe(false);
  });

  it("identifies PDF receipts by stored mime", () => {
    expect(isPdfReceipt({ mime: "application/pdf" })).toBe(true);
    expect(isPdfReceipt({ mime: "image/png" })).toBe(false);
  });

  it("exposes the file-picker accept string", () => {
    expect(RECEIPT_ACCEPT).toBe("image/*,application/pdf");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest dashboard/expenses/_lib/receiptFileType`
Expected: FAIL (`Cannot find module './receiptFileType'`).

- [ ] **Step 3: Implement** `src/app/dashboard/expenses/_lib/receiptFileType.ts`:

```ts
/** File-picker `accept` for expense receipts. */
export const RECEIPT_ACCEPT = "image/*,application/pdf";

/** Receipts may be any image or a PDF — nothing else (15 MB cap is checked separately). */
export function isAcceptedReceiptType(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf";
}

/** A stored receipt is a PDF (rendered as a file tile, opened in a new tab). */
export function isPdfReceipt(receipt: { mime: string }): boolean {
  return receipt.mime === "application/pdf";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest dashboard/expenses/_lib/receiptFileType`
Expected: PASS.

- [ ] **Step 5: Update `ReceiptUploader.tsx`.**
  1. Import `RECEIPT_ACCEPT, isAcceptedReceiptType, isPdfReceipt` from `../_lib/receiptFileType`, and add `FileText` to the `lucide-react` import.
  2. In `handleFiles`, change the type guard to `if (!isAcceptedReceiptType(file.type))`, with the message ``${file.name}: only images or PDF files can be attached as receipts.``
  3. Change the input to `accept={RECEIPT_ACCEPT}`, and the hint copy to `Images or PDF · up to {MAX_RECEIPT_MB} MB each`.
  4. Tenant lookup. The file already repeats the `getSession()` → `app_metadata.tenant_schema` lookup three times, and this task adds a fourth use. Extract it into one module-level helper and use it at all four call sites:

```ts
async function currentTenantSchema(): Promise<string | undefined> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return session?.user.app_metadata?.tenant_schema as string | undefined;
}
```

  5. Add an `openReceipt` function inside the component. It opens the new tab synchronously, so popup blockers allow it, then points the tab at a fresh 60-second signed URL. A stale thumbnail URL is never reused.

```ts
  async function openReceipt(receipt: ExpenseReceipt) {
    // Open synchronously (inside the click) so popup blockers allow it, then
    // point it at a freshly signed URL — the thumbnail URLs expire after 60s.
    const tab = window.open("", "_blank");
    const tenantSchema = await currentTenantSchema();
    const path = tenantSchema ? pathFromStoredReceipt(receipt, tenantSchema) : null;
    const signed = path
      ? await createClient().storage.from(EXPENSE_RECEIPTS_BUCKET).createSignedUrl(path, 60)
      : null;
    if (!signed?.data?.signedUrl) {
      tab?.close();
      toastError("Couldn't open receipt", "Try again in a moment.");
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = signed.data.signedUrl;
    }
  }
```

  6. In the tile map, render a PDF tile before the image branch. The existing image branch and the remove button stay unchanged:

```tsx
              {isPdfReceipt(receipt) ? (
                <button
                  type="button"
                  onClick={() => openReceipt(receipt)}
                  aria-label={`Open receipt ${receipt.name}`}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded bg-(--color-surface-subtle) px-1"
                >
                  <FileText size={18} className="text-(--color-text-faint)" />
                  <span className="w-full truncate text-[11px] text-(--color-text-muted)">{receipt.name}</span>
                </button>
              ) : signedUrls[receipt.path] ? (
```

  (The existing `: (` placeholder branch for images whose signed URL hasn't loaded yet stays as the final `else`.)

- [ ] **Step 6: Docs.**
  - `expenses/CLAUDE.md`: add `_lib/receiptFileType.ts` (+ test), and note that receipts can be images or PDFs.
  - `expenses/SKILL.md` gotchas:
    - "PDFs need no bucket change — 046 sets no `allowed_mime_types`";
    - "`openReceipt` opens the tab before awaiting the signed URL, because a `window.open` after an `await` is popup-blocked; thumbnails' 60s URLs are never reused for opening".

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/expenses/_lib/receiptFileType.ts src/app/dashboard/expenses/_lib/receiptFileType.test.ts \
  src/app/dashboard/expenses/_components/ReceiptUploader.tsx \
  src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "feat(expenses): accept PDF receipts and open them in a new tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `extractReceiptText`, browser text extraction (pdf.js + tesseract)

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/app/dashboard/expenses/_lib/extractReceiptText.ts`, `extractReceiptText.test.ts`
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`

**Interfaces:**
- Produces: `extractReceiptText(file: Blob, mime: string): Promise<{ text: string; source: "pdf-text" | "ocr" }>`, `hasUsablePdfText(text: string): boolean`, `MIN_PDF_TEXT_CHARS = 40`.
- The module must be safe to import in Jest (`testEnvironment: node`). Only `hasUsablePdfText` is unit-tested; the two libraries load only via dynamic `import()` inside `extractReceiptText`.

- [ ] **Step 1: Install the libraries**

Run: `npm install pdfjs-dist@^6.3.289 tesseract.js@^7.0.0`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Check the installed APIs before writing code.** Read `node_modules/pdfjs-dist/types/src/display/api.d.ts`, specifically `RenderParameters` and `getDocument`, and `node_modules/tesseract.js/src/index.d.ts`, specifically `createWorker` and `recognize`. The Step 5 code assumes:
  - `getDocument({ data }).promise`;
  - `page.getTextContent()` items with `str` and `hasEOL`;
  - `page.getViewport({ scale })`;
  - `page.render({ canvas, viewport }).promise`;
  - `createWorker(langs)` → `worker.recognize(image)` → `{ data: { text } }`, and `worker.terminate()`.

  If an installed signature differs (for example, render requiring `canvasContext`), adapt the call to the installed types and note the change in your report. Do not use `any`, and do not use `@ts-ignore`.

- [ ] **Step 3: Write the failing test** `src/app/dashboard/expenses/_lib/extractReceiptText.test.ts`:

```ts
import { MIN_PDF_TEXT_CHARS, hasUsablePdfText } from "./extractReceiptText";

describe("hasUsablePdfText", () => {
  it("treats a PDF with a real text layer as usable", () => {
    expect(hasUsablePdfText("Rechnung RE-1\nGesamtbetrag 44,63 €\nUSt-IdNr DE123456789")).toBe(true);
  });

  it("treats a scanned PDF (almost no text) as unusable", () => {
    expect(hasUsablePdfText("  \n \n 1 ")).toBe(false);
    expect(hasUsablePdfText("")).toBe(false);
  });

  it("counts non-whitespace characters against the threshold", () => {
    expect(hasUsablePdfText("x".repeat(MIN_PDF_TEXT_CHARS - 1) + "   ")).toBe(false);
    expect(hasUsablePdfText("x ".repeat(MIN_PDF_TEXT_CHARS))).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest dashboard/expenses/_lib/extractReceiptText`
Expected: FAIL (`Cannot find module './extractReceiptText'`).

- [ ] **Step 5: Implement** `src/app/dashboard/expenses/_lib/extractReceiptText.ts`:

```ts
/**
 * Browser-only text extraction for a receipt file. Nothing leaves the
 * browser except the fetch of the libraries' worker/language files from
 * jsdelivr (pdf.js worker, tesseract core + deu/eng traineddata), which the
 * browser then caches. Both libraries are imported dynamically so they never
 * enter the main bundle — keep them out of top-level imports.
 */

/** A PDF with fewer non-whitespace characters than this is treated as a scan and OCR'd. */
export const MIN_PDF_TEXT_CHARS = 40;

/** Whether a PDF's text layer has enough content to parse (vs. a scanned image). */
export function hasUsablePdfText(text: string): boolean {
  return text.replace(/\s/g, "").length >= MIN_PDF_TEXT_CHARS;
}

export interface ExtractedReceiptText {
  text: string;
  source: "pdf-text" | "ocr";
}

const OCR_LANGUAGES = ["deu", "eng"];
const OCR_RENDER_SCALE = 2;

async function ocr(image: Blob | HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(OCR_LANGUAGES);
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function extractReceiptText(file: Blob, mime: string): Promise<ExtractedReceiptText> {
  if (mime !== "application/pdf") {
    return { text: await ocr(file), source: "ocr" };
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("")
      );
    }
    const text = pages.join("\n");
    if (hasUsablePdfText(text)) return { text, source: "pdf-text" };

    // Scanned PDF: OCR a render of page 1 only (spec: pages beyond 1 are out of scope).
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    return { text: await ocr(canvas), source: "ocr" };
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx jest dashboard/expenses/_lib/extractReceiptText`
Expected: PASS, 3 tests. Importing the module under Jest must not load either library.

- [ ] **Step 7: Docs.**
  - `expenses/CLAUDE.md`: add `_lib/extractReceiptText.ts` (+ test) as "browser-only", and add `pdfjs-dist`/`tesseract.js` to shared deps as "dynamically imported".
  - `expenses/SKILL.md` gotchas:
    - "Never import `pdfjs-dist`/`tesseract.js` at top level — bundle size and SSR";
    - "Workers/language data load from jsdelivr; if a Content-Security-Policy is ever added, `script-src`/`worker-src`/`connect-src` must allow `cdn.jsdelivr.net`";
    - "scanned PDFs: only page 1 is OCR'd".

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/app/dashboard/expenses/_lib/extractReceiptText.ts \
  src/app/dashboard/expenses/_lib/extractReceiptText.test.ts \
  src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "feat(expenses): extract receipt text in the browser (pdf.js text layer, tesseract OCR)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The "Fill from receipt" button in both expense modals

**Files:**
- Modify: `src/components/ui/FormFields.tsx` (`Input`, `Select`, `Textarea`)
- Create: `src/app/dashboard/expenses/_components/useReceiptAutofill.ts`
- Modify: `src/app/dashboard/expenses/_components/ReceiptUploader.tsx`
- Modify: `src/app/dashboard/expenses/_components/AddExpenseModal.tsx`, `EditExpenseModal.tsx`
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`, `src/components/ui/SKILL.md`

**Interfaces:**
- Consumes: `parseReceipt` (Task 1), `applyReceiptToForm`/`ReceiptFillableForm`/`ReceiptField`/`ReceiptFillBaseline` (Task 2), `extractReceiptText` (Task 4, dynamically imported), `EXPENSE_RECEIPTS_BUCKET`/`pathFromStoredReceipt` (`../_lib/receiptPath`).
- Produces:
  - `useReceiptAutofill<F extends ReceiptFillableForm>(form: F, setForm: Dispatch<SetStateAction<F>>, baseline: ReceiptFillBaseline)`, which returns `{ fillingPath: string | null; fillFromReceipt(receipt: ExpenseReceipt): Promise<void>; highlight(field: ReceiptField): string | undefined; clearHighlight(field: string): void; resetHighlights(): void }`.
  - New optional `ReceiptUploader` props `onFillFromReceipt?: (receipt: ExpenseReceipt) => void` and `fillingPath?: string | null`.

- [ ] **Step 1: Make the form atoms merge `className`.** In `src/components/ui/FormFields.tsx`, `Input` currently renders `<input className={inputClass} {...props} />`, so a passed `className` replaces the whole base style. Change `Input`, `Select` and `Textarea` to destructure `className` and render `className={className ? `${inputClass} ${className}` : inputClass}`. For `Select`, keep its existing children rendering, and for `Textarea` keep `rows={3}`. First check that no current caller relies on the replace behaviour:

Run: `grep -rn "<Input[^>]*className=\|<Select[^>]*className=\|<Textarea[^>]*className=" src`
Expected: review each hit. If one of them passes a full replacement class list, stop and report NEEDS_CONTEXT with the list rather than changing the atom. Add one line to `src/components/ui/SKILL.md`'s FormFields entry: "`className` on `Input`/`Select`/`Textarea` is appended to the base input style (used for the receipt-autofill highlight ring)."

- [ ] **Step 2: Create the hook** `src/app/dashboard/expenses/_components/useReceiptAutofill.ts`:

```ts
"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { parseReceipt } from "../_lib/parseReceipt";
import {
  applyReceiptToForm,
  type ReceiptField,
  type ReceiptFillBaseline,
  type ReceiptFillableForm,
} from "../_lib/applyReceiptToForm";
import { EXPENSE_RECEIPTS_BUCKET, pathFromStoredReceipt } from "../_lib/receiptPath";
import type { ExpenseReceipt } from "@/types";

/** Token-based ring on a field the receipt filled, until the user edits it. */
const AUTOFILL_HIGHLIGHT = "ring-2 ring-(--color-primary)/40";

async function downloadReceipt(receipt: ExpenseReceipt): Promise<Blob> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
  const path = tenantSchema ? pathFromStoredReceipt(receipt, tenantSchema) : null;
  if (!path) throw new Error("receipt_not_in_tenant");
  const { data, error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).download(path);
  if (error || !data) throw new Error("receipt_download_failed");
  return data;
}

/**
 * "Fill from receipt": download the stored receipt, read it in the browser
 * (no AI, no server), parse it and merge it into the form without
 * overwriting anything typed. Shared by the Add and Edit expense modals.
 */
export function useReceiptAutofill<F extends ReceiptFillableForm>(
  form: F,
  setForm: Dispatch<SetStateAction<F>>,
  baseline: ReceiptFillBaseline
) {
  const { success, info, error: toastError } = useToast();
  const [fillingPath, setFillingPath] = useState<string | null>(null);
  const [filledFields, setFilledFields] = useState<ReadonlySet<string>>(new Set());

  // Reading takes seconds (OCR); merge into the form as it is when reading
  // finishes, so anything typed meanwhile is respected, not the snapshot
  // from when the button was clicked.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  });

  async function fillFromReceipt(receipt: ExpenseReceipt) {
    setFillingPath(receipt.path);
    try {
      const blob = await downloadReceipt(receipt);
      const { extractReceiptText } = await import("../_lib/extractReceiptText");
      const { text } = await extractReceiptText(blob, receipt.mime);
      const parsed = parseReceipt(text);
      const { form: next, filled } = applyReceiptToForm(formRef.current, parsed, baseline);

      if (filled.length > 0) {
        setForm(next);
        setFilledFields(new Set(filled));
        success(
          `Filled ${filled.length} field${filled.length !== 1 ? "s" : ""} from receipt`,
          "Check the highlighted fields before saving."
        );
      } else if (Object.keys(parsed).length > 0) {
        info("Nothing to fill", "Every field this receipt covers already has a value.");
      } else {
        toastError("Couldn't read any details from this receipt", "Fill the fields in manually.");
      }
    } catch {
      toastError("Couldn't read this receipt", "Try a clearer photo, or fill the fields in manually.");
    } finally {
      setFillingPath(null);
    }
  }

  function clearHighlight(field: string) {
    setFilledFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }

  return {
    fillingPath,
    fillFromReceipt,
    highlight: (field: ReceiptField) => (filledFields.has(field) ? AUTOFILL_HIGHLIGHT : undefined),
    clearHighlight,
    resetHighlights: () => setFilledFields(new Set()),
  };
}
```

(`formRef` is synced in an effect, not during render: React 19's `react-hooks/refs` lint rule rejects writing a ref during render.)

- [ ] **Step 3: Add the per-receipt button to `ReceiptUploader.tsx`.**
  - Add props `onFillFromReceipt?: (receipt: ExpenseReceipt) => void` and `fillingPath?: string | null` to `Props` and the destructure.
  - Add `ScanText` to the `lucide-react` import.
  - Inside each tile, after the image/PDF block and before the remove button, render the button below, only when `onFillFromReceipt` is provided. Also add `|| fillingPath === receipt.path` to the remove button's `disabled`, so a receipt can't be removed while it's being read.

```tsx
              {onFillFromReceipt && (
                <button
                  type="button"
                  onClick={() => onFillFromReceipt(receipt)}
                  disabled={uploading || disabled || (fillingPath ?? null) !== null}
                  aria-label={`Fill expense fields from ${receipt.name}`}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded-(--radius-btn) px-1 py-0.5 text-[11px] font-medium text-(--color-primary) hover:bg-(--color-surface-subtle) disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fillingPath === receipt.path ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Reading…
                    </>
                  ) : (
                    <>
                      <ScanText size={12} />
                      Fill
                    </>
                  )}
                </button>
              )}
```

- [ ] **Step 4: Wire the Add modal** (`AddExpenseModal.tsx`):
  1. `import { useReceiptAutofill } from "./useReceiptAutofill";`, and add `useMemo` to the React import.
  2. After the `form` state:

```tsx
  // Values that still count as "untouched" for autofill — a receipt may
  // replace today's date, EUR and "other", never anything typed.
  const autofillBaseline = useMemo(() => {
    const d = makeDefaults(defaultVatRate);
    return { currency: d.currency, category: d.category, date: d.date };
  }, [defaultVatRate]);
  const autofill = useReceiptAutofill(form, setForm, autofillBaseline);
```

  3. In `set()`, add `autofill.clearHighlight(key);` before the `setForm` call.
  4. In `handleClose` and after a successful submit, next to `setForm(makeDefaults(defaultVatRate))`, call `autofill.resetHighlights();`.
  5. Change the submit button to `disabled={saving || receiptsBusy || autofill.fillingPath !== null}`, with label `{saving ? "Saving…" : receiptsBusy ? "Uploading…" : autofill.fillingPath ? "Reading receipt…" : "Add Expense"}`.
  6. Pass `className={autofill.highlight("<field>")}` to each fillable control:
     - the Amount `Input` (`"amount"`), the Currency `Select` (`"currency"`), the Category `Select` (`"category"`) and the Date `Input` (`"date"`);
     - the Vendor, Invoice Number and Vendor VAT Number `Input`s (`"vendor"`, `"invoice_number"`, `"vendor_vat_number"`);
     - the VAT Rate `Input` (`"vat_rate"`).
  7. On `<ReceiptUploader …>`, add `onFillFromReceipt={autofill.fillFromReceipt}` and `fillingPath={autofill.fillingPath}`.

- [ ] **Step 5: Wire the Edit modal** (`EditExpenseModal.tsx`) the same way, with these differences:
  - Baseline is a module-level `const EDIT_AUTOFILL_BASELINE = {} as const;`. A saved expense has no "untouched defaults", so only blank fields fill.
  - Call `const autofill = useReceiptAutofill(form, setForm, EDIT_AUTOFILL_BASELINE);`.
  - Reset highlights on close. Add a `handleClose()` that calls `autofill.resetHighlights()` then `onClose()`, and use it for the Cancel button and the `Modal`'s `onClose`. Also call `autofill.resetHighlights()` after a successful save. Do not reset inside the render-time `loadedExpenseId` block: `page.tsx` already remounts this modal per row via `key={editTarget?.id}`, so switching rows starts with fresh hook state.
  - Submit: `disabled={saving || receiptsBusy || autofill.fillingPath !== null}`, label adds `autofill.fillingPath ? "Reading receipt…"` before `"Save Changes"`.
  - Same `className` highlights and `ReceiptUploader` props as the Add modal.

- [ ] **Step 6: Run the feature's tests**

Run: `npx jest dashboard/expenses src/components/ui`
Expected: PASS.

- [ ] **Step 7: Docs.**
  - `expenses/CLAUDE.md` file map: add `_components/useReceiptAutofill.ts`. Data flow: "Fill → download blob (tenant-checked path) → `extractReceiptText` (dynamic import) → `parseReceipt` → `applyReceiptToForm` against the latest form".
  - `expenses/SKILL.md`, a minimal-file-set entry: "Change which fields autofill / how → `_lib/applyReceiptToForm.ts` (+ test); change the button/flow → `useReceiptAutofill.ts` + `ReceiptUploader.tsx`".
  - `expenses/SKILL.md` gotchas:
    - "merge uses `formRef.current` at the end of reading, not the click-time snapshot";
    - "Save is disabled while a receipt is being read, so the merge can't land after submit".

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/FormFields.tsx src/components/ui/SKILL.md \
  src/app/dashboard/expenses/_components/ src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "feat(expenses): Fill from receipt button in Add/Edit expense modals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Hand off for a manual check.** Tell the user what to verify in the browser. If the Playwright MCP is connected and `npm run dev` is already running, drive the browser yourself instead.
  - attach a PDF invoice, see a file tile, and have it open in a new tab;
  - Fill on a text PDF fills the fields in under a second;
  - Fill on a phone photo shows "Reading…" (the first run downloads the language data), then fills;
  - typed values are never replaced;
  - highlighted fields lose their ring once edited;
  - Save is disabled while reading;
  - on a receipt with mixed 7%/19% VAT, the VAT box is left alone.
