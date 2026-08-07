# Expenses Import Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Expenses importer a format dropdown with a `vorsteuer` (German input-tax ledger) option that handles locale dates and numbers, multilingual headers, noise rows, supplied-VAT-wins and negative credit notes.

**Architecture:** The header vocabulary and resolution helpers move out of Sales' private module into a shared `lib/utils/importAliases.ts` that both features consume. Expenses gains a feature-private format registry mirroring Sales' shape, plus a pure keyword→category map in `_lib/`. A migration relaxes `expenses_amount_check` so a credit note is simply a negative expense and every existing SUM reconciles unchanged.

**Tech Stack:** TypeScript, Jest, Next.js App Router, Redux Toolkit, Supabase/Postgres.

**Source spec:** `docs/superpowers/specs/2026-08-07-expenses-import-formats-design.md`

## Two deliberate deviations from the spec

Both are improvements found while reading the real code. They are intentional; do not "restore" the spec's version.

1. **The spec proposed two shared modules** (`importAliases.ts` + `importCoerce.ts`). The only coercion actually needed beyond what exists is stripping `%` from `"19%"`, and a module containing one function is worse than putting it in `localeParse.ts`, which is already the locale-parsing home. So: **one** new shared module.
2. **Headers must be normalised by stripping a trailing parenthesised unit** before alias matching. `Gross Amount (€)` lowercases to `gross amount (€)`, and the real file already shows `€` mojibaked to `â¬` — matching on that is fragile. Stripping to `gross amount` is encoding-proof.

## Global Constraints

- **Never commit to `main`.** Work happens on `feat/expenses-import-formats` (already created off `main` @ `a3c8105`).
- **Every commit must leave the tree type-clean.** `.husky/pre-commit` runs `tsc --noEmit`, `eslint` and the project verifier. A commit that depends on a later task to compile is rejected. Do not use `--no-verify`.
- **Sales' import control flow must not change.** Only its import statements and the two `resolveHeaders` call sites move. That code took three fix rounds to stabilise the day before this work; keep the blast radius to imports.
- **`expenseImportFormats.ts` and `expenseCategory.ts` are pure modules** — no React, Supabase or Redux imports. That is what makes them testable.
- **The `generic` expense format must keep its current behaviour**, except for gaining locale tolerance. It keeps required `date`/`title`/`amount`, and gains **no** skip classification — a blank or summary row still errors there. Only `vorsteuer` skips.
- **The file's `vat_amount` always wins over a derived value.** Four real rows carry a 19% rate with €0.00 actual VAT; deriving would invent tax.
- Tenant DDL goes through `SELECT public.run_on_all_tenant_schemas($$ … {{schema}} … $$)`, must be idempotent, and must be mirrored into `provision_tenant_schema()` in `005_tenant_provisioning.sql` (the 2-places rule).
- Do **not** run `npm test`, `npx tsc --noEmit`, `npm run lint`, or a dev server. You MAY run `npx jest <path>` for the files you are working on. The user runs the full gates.
- Do **not** apply migrations. The Supabase MCP servers are read-only; the user applies them.
- Docs ship in the **same commit** as the code (AGENTS.md).
- This repo mandates `graphify query "<question>"` before broad grepping; read raw files directly to modify or verify specific lines.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/utils/csv.ts` | quote-aware row splitting (bug fix) |
| `src/lib/utils/localeParse.ts` | `parseLocaleRate` — `%`-tolerant number |
| `src/lib/utils/importAliases.ts` | **new** — shared header vocabulary + resolution |
| `src/app/dashboard/sales/_components/importFormats.ts` | adopts the shared module (imports only) |
| `supabase/migrations/032_expenses_allow_negative_amount.sql` | **new** — relax the CHECK |
| `supabase/migrations/005_tenant_provisioning.sql` | 2-places mirror |
| `src/app/dashboard/page.tsx` | category amount colour follows sign |
| `src/app/dashboard/expenses/_lib/expenseCategory.ts` | **new** — keyword → category |
| `src/app/dashboard/expenses/_components/expenseImportFormats.ts` | **new** — the registry |
| `src/app/dashboard/expenses/_components/ImportExpensesModal.tsx` | format dropdown, preview, negatives |
| docs | `expenses/CLAUDE.md`, `expenses/SKILL.md`, `sales/CLAUDE.md`, `supabase/SKILL.md` + `CLAUDE.md` |

---

### Task 1: Fix embedded newlines in CSV parsing

**Files:**
- Modify: `src/lib/utils/csv.ts:80-94`
- Test: `src/lib/utils/csv.test.ts`

**Interfaces:**
- Produces: `parseCsvText` keeps its exact signature — `(text: string) => { headers: string[]; rows: Record<string, string>[] }`. Only its row-splitting changes.

- [ ] **Step 1: Write the failing test**

If `src/lib/utils/csv.test.ts` does not exist, create it and import `parseCsvText` from `./csv`.

```typescript
describe("parseCsvText — newlines inside quoted fields", () => {
  it("keeps a quoted field's line break as ONE row", () => {
    // Real row from a German Amazon VAT ledger: the description wraps.
    const csv =
      'date,description,amount\n' +
      '31.05.2026,"Contribuciones ecológicas y tarifas de\nservicio de RAP",30.42';
    const { rows } = parseCsvText(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe(
      "Contribuciones ecológicas y tarifas de\nservicio de RAP",
    );
    expect(rows[0].amount).toBe("30.42");
  });

  it("still splits ordinary rows", () => {
    const { rows } = parseCsvText("a,b\n1,2\n3,4");
    expect(rows).toHaveLength(2);
    expect(rows[1].a).toBe("3");
  });

  it("handles an escaped double quote inside a quoted field", () => {
    const csv = 'a,b\n"Gebühren ""Versand durch Amazon""",5';
    const { rows } = parseCsvText(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBe('Gebühren "Versand durch Amazon"');
  });

  it("still drops blank lines", () => {
    const { rows } = parseCsvText("a,b\n1,2\n\n\n3,4");
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx jest src/lib/utils/csv`
Expected: FAIL — the first test yields 2 rows, because `.split("\n")` cuts the quoted field in half.

- [ ] **Step 3: Implement quote-aware row splitting**

Add above `parseCsvText`:

```typescript
/**
 * Split CSV text into logical rows, honouring newlines INSIDE quoted fields.
 * A naive `.split("\n")` breaks any field containing a line break, and real
 * exports do produce them — a German Amazon VAT ledger wraps long fee
 * descriptions across two lines inside one quoted cell.
 *
 * Quote characters are preserved so `parseLine` still sees a well-formed
 * field; this function only decides where a row ends.
 */
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // An escaped "" inside a quoted field must not toggle the state.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "\n" && !inQuotes) {
      rows.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  rows.push(current);
  return rows;
}
```

Then replace the `lines` assignment inside `parseCsvText` (currently `.split("\n")` at line 85) so it uses the new splitter, keeping the BOM strip and CR normalisation exactly as they are:

```typescript
  const lines = splitRows(
    text
      .replace(new RegExp("^\\uFEFF"), "") // strip UTF-8 BOM (Excel prepends it)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n"),
  ).filter((l) => l.trim() !== "");
```

Change nothing else in the file.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx jest src/lib/utils/csv`
Expected: PASS. Then run `npx jest src/app/dashboard/sales` — the Sales importer uses this same function and must be unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/csv.ts src/lib/utils/csv.test.ts
git commit -m "fix(csv): keep newlines inside quoted fields as one row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared header vocabulary

**Files:**
- Create: `src/lib/utils/importAliases.ts`
- Create: `src/lib/utils/importAliases.test.ts`
- Modify: `src/lib/utils/localeParse.ts`
- Modify: `src/lib/utils/localeParse.test.ts`
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`

**Interfaces:**
- Produces, consumed by Tasks 5 and 6:
  ```typescript
  export interface ColumnSpec { key: string; aliases: string[]; required: boolean }
  export interface HeaderResolution { mapping: Map<string, string>; missingRequired: string[] }
  export const ALIASES: Record<string, string[]>;
  export function normalizeHeader(raw: string): string;
  export function resolveHeaders(rawHeaders: string[], columns: ColumnSpec[]): HeaderResolution;
  export function canonicalizeRow(raw: Record<string, string>, mapping: Map<string, string>): Record<string, string>;
  ```
- Also produces `parseLocaleRate(input: string | undefined): number | null` from `localeParse.ts`.
- **Signature change:** `resolveHeaders` now takes `columns: ColumnSpec[]`, not a whole format object. Sales' call sites pass `format.columns`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/utils/importAliases.test.ts`:

```typescript
import { ALIASES, normalizeHeader, resolveHeaders, canonicalizeRow, type ColumnSpec } from "./importAliases";

describe("normalizeHeader", () => {
  it("strips a trailing parenthesised unit", () => {
    // "Gross Amount (€)" — and the € is often mojibaked to "â¬" by Excel's
    // encoding, so matching on it directly is fragile.
    expect(normalizeHeader("Gross Amount (€)")).toBe("gross amount");
    expect(normalizeHeader("Gross Amount (â¬)")).toBe("gross amount");
    expect(normalizeHeader("VAT Rate (%)")).toBe("vat rate");
  });

  it("lowercases and trims", () => {
    expect(normalizeHeader("  Datum  ")).toBe("datum");
  });

  it("leaves a mid-string parenthesis alone", () => {
    expect(normalizeHeader("Fee (net) total")).toBe("fee (net) total");
  });
});

describe("resolveHeaders", () => {
  const columns: ColumnSpec[] = [
    { key: "date", aliases: ["date", "datum"], required: true },
    { key: "amount", aliases: ["amount", "gross amount", "brutto"], required: true },
    { key: "vendor", aliases: ["vendor", "supplier", "lieferant"], required: false },
  ];

  it("maps German and unit-suffixed headers", () => {
    const { mapping, missingRequired } = resolveHeaders(
      ["Datum", "Gross Amount (€)", "Lieferant"],
      columns,
    );
    expect(missingRequired).toEqual([]);
    expect(mapping.get("Datum")).toBe("date");
    expect(mapping.get("Gross Amount (€)")).toBe("amount");
    expect(mapping.get("Lieferant")).toBe("vendor");
  });

  it("reports missing required columns", () => {
    const { missingRequired } = resolveHeaders(["Datum"], columns);
    expect(missingRequired).toEqual(["amount"]);
  });

  it("keeps the FIRST header when two map to one key", () => {
    const { mapping } = resolveHeaders(["Amount", "Brutto"], columns);
    expect(mapping.get("Amount")).toBe("amount");
    expect(mapping.has("Brutto")).toBe(false);
  });
});

describe("canonicalizeRow", () => {
  it("rekeys a raw row and fills missing values with empty string", () => {
    const mapping = new Map([["Datum", "date"], ["Lieferant", "vendor"]]);
    expect(canonicalizeRow({ Datum: "13.04.2026" }, mapping)).toEqual({
      date: "13.04.2026",
      vendor: "",
    });
  });
});

describe("ALIASES", () => {
  it("carries the expense vocabulary the vorsteuer format needs", () => {
    expect(ALIASES.vendor).toContain("supplier");
    expect(ALIASES.invoice_number).toContain("rechnungsnummer");
    expect(ALIASES.vendor_vat_number).toContain("ustid des anbieters");
    expect(ALIASES.tax_number).toContain("steuernummer");
    expect(ALIASES.net_amount).toContain("net amount");
  });

  it("keeps vendor_vat_number and tax_number separate", () => {
    // The sheet has BOTH columns and populates whichever the vendor has, so
    // they must resolve independently and be merged per ROW, not per file.
    expect(ALIASES.vendor_vat_number).not.toContain("steuernummer");
  });
});
```

Add to `src/lib/utils/localeParse.test.ts`:

```typescript
describe("parseLocaleRate", () => {
  it("accepts a trailing percent sign", () => {
    expect(parseLocaleRate("19%")).toBe(19);
    expect(parseLocaleRate("19 %")).toBe(19);
  });

  it("still accepts a plain number and German decimals", () => {
    expect(parseLocaleRate("19")).toBe(19);
    expect(parseLocaleRate("7,5")).toBe(7.5);
  });

  it("returns null for blank or unparseable input", () => {
    expect(parseLocaleRate("")).toBeNull();
    expect(parseLocaleRate(undefined)).toBeNull();
    expect(parseLocaleRate("abc")).toBeNull();
  });
});
```

Add `parseLocaleRate` to that file's existing import from `./localeParse`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/lib/utils/importAliases src/lib/utils/localeParse`
Expected: FAIL — the module and function do not exist.

- [ ] **Step 3: Add `parseLocaleRate`**

In `src/lib/utils/localeParse.ts`, after `parseLocaleNumber`:

```typescript
/**
 * `parseLocaleNumber` for a percentage cell. German sheets write a VAT rate
 * as "19%", which `parseLocaleNumber` rejects outright — its guard is
 * /^[+-]?[\d.,]+$/ and "%" is not a digit. The percent sign carries no
 * information here (the column is already "VAT Rate (%)"), so strip it.
 */
export function parseLocaleRate(input: string | undefined): number | null {
  if (input == null) return null;
  return parseLocaleNumber(input.replace(/%/g, ""));
}
```

- [ ] **Step 4: Create the shared module**

Create `src/lib/utils/importAliases.ts`. Move `ALIASES`, `resolveHeaders` and `canonicalizeRow` out of `src/app/dashboard/sales/_components/importFormats.ts` verbatim, then apply the three changes below.

```typescript
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

export function resolveHeaders(rawHeaders: string[], columns: ColumnSpec[]): HeaderResolution {
  const mapping = new Map<string, string>();
  for (const raw of rawHeaders) {
    const normalized = normalizeHeader(raw);
    const spec = columns.find((c) => c.aliases.includes(normalized));
    if (spec && ![...mapping.values()].includes(spec.key)) {
      mapping.set(raw, spec.key);
    }
  }
  const resolved = new Set(mapping.values());
  const missingRequired = columns
    .filter((c) => c.required && !resolved.has(c.key))
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
```

The three changes from the moved originals: `resolveHeaders` takes `columns` instead of `format`; it calls `normalizeHeader` instead of inlining `.trim().toLowerCase()`; and `ALIASES` gains the expense entries.

- [ ] **Step 5: Point Sales at the shared module**

In `src/app/dashboard/sales/_components/importFormats.ts`:

1. Delete the local `ALIASES`, `resolveHeaders`, `canonicalizeRow` and the local `HeaderResolution` interface.
2. Add the import:

```typescript
import {
  ALIASES,
  resolveHeaders,
  canonicalizeRow,
  type ColumnSpec,
  type HeaderResolution,
} from "@/lib/utils/importAliases";
```

3. Re-export the two functions so existing importers of this module keep working unchanged — `ImportSalesModal.tsx` imports them from here:

```typescript
export { resolveHeaders, canonicalizeRow, type HeaderResolution };
```

4. Update both `resolveHeaders(headers, format)` call sites to `resolveHeaders(headers, format.columns)`. Find them with `grep -n "resolveHeaders(" src/`.
5. If `ImportFormat`'s `columns` field declares its own inline element type, change it to `ColumnSpec[]`. Do not otherwise touch `ImportFormat` or any validation logic.

**Change nothing else in this file.** No control-flow edits.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx jest src/lib/utils src/app/dashboard/sales`
Expected: PASS, including every pre-existing Sales import test. If a Sales test fails, you changed more than imports — revert that part.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/importAliases.ts src/lib/utils/importAliases.test.ts src/lib/utils/localeParse.ts src/lib/utils/localeParse.test.ts src/app/dashboard/sales/_components/importFormats.ts
git commit -m "refactor(import): share the header vocabulary between Sales and Expenses

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Allow negative expense amounts

**Files:**
- Create: `supabase/migrations/032_expenses_allow_negative_amount.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`
- Modify: `src/app/dashboard/page.tsx:774`
- Modify: `supabase/SKILL.md`, `supabase/CLAUDE.md`

**Interfaces:**
- Produces: `expenses.amount` accepts negative values. Tasks 5 and 6 rely on this — the validator stops rejecting `amount <= 0`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/032_expenses_allow_negative_amount.sql`:

```sql
-- ============================================================
-- 032 — allow negative expenses (credit notes)
--
-- A German input-tax ledger (Vorsteuerkonto) contains credit notes alongside
-- invoices: "Erstattung von Verkäufergebühren", "Tarifas reembolsadas",
-- "Återbetalda avgifter". They are negative, and they are real money — one
-- quarter's sheet carried -218.14 net and -41.44 VAT.
--
-- `expenses_amount_check CHECK (amount >= 0)` made them unstorable, so the
-- importer had to drop them and the dashboard's totals could never reconcile
-- with the filed VAT return. Relaxing the check makes a credit note simply a
-- negative expense, and every existing SUM (totals, VAT Position, monthly
-- trend) then reconciles with no aggregate changes.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.expenses
    drop constraint if exists expenses_amount_check;
$$);
```

- [ ] **Step 2: Mirror it into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, find the `CREATE TABLE IF NOT EXISTS %1$I.expenses` block and remove the `CHECK (amount >= 0)` from its `amount` column, leaving the column and its type otherwise unchanged. Add a trailing comment on that line:

```sql
      amount            numeric(12,2) NOT NULL, -- may be negative: credit notes (032)
```

Change nothing else in that function.

- [ ] **Step 3: Colour the category amount by sign**

`src/app/dashboard/page.tsx:774` hardcodes `text-(--color-danger)` for every Expenses-by-Category amount. A negative total is money coming *back*, so red misreads it. Replace that `<span>` with:

```tsx
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        amount < 0
                          ? "text-(--color-success)"
                          : "text-(--color-danger)"
                      }`}
                    >
                      {formatCurrency(amount)}
                    </span>
```

This is the only change to this file. "Expenses by Category" is a list, not a chart — no clamping or chart handling is needed anywhere.

- [ ] **Step 4: Document the migration**

Add a `032_expenses_allow_negative_amount.sql` row to `supabase/SKILL.md`'s file-map table and a matching entry in `supabase/CLAUDE.md`, stating that `provision_tenant_schema()` was updated in the same commit.

`supabase/SKILL.md` carries a dated "VERIFIED LIVE" block above that table. Add `032` to its outstanding list beside `control-plane/004`, and leave the rest of the block's findings untouched — they were verified against the live databases and are still accurate.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/032_expenses_allow_negative_amount.sql supabase/migrations/005_tenant_provisioning.sql src/app/dashboard/page.tsx supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(expenses): allow negative amounts for credit notes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Multilingual category mapping

**Files:**
- Create: `src/app/dashboard/expenses/_lib/expenseCategory.ts`
- Create: `src/app/dashboard/expenses/_lib/expenseCategory.test.ts`

**Interfaces:**
- Produces, consumed by Task 5: `export function categoryFor(description: string | undefined): ExpenseCategory`

- [ ] **Step 1: Write the failing tests**

```typescript
import { categoryFor } from "./expenseCategory";

describe("categoryFor", () => {
  it("maps advertising", () => {
    expect(categoryFor("Ads")).toBe("advertising");
    expect(categoryFor("Werbung")).toBe("advertising");
  });

  it("maps Amazon fulfilment fees across all six marketplace languages", () => {
    // Amazon localises the SAME fee per marketplace — these all appear in one
    // quarterly ledger.
    expect(categoryFor('Gebühren im Zusammenhang mit "Versand durch Amazon"')).toBe("shipping");
    expect(categoryFor("Fulfilment by Amazon Fees")).toBe("shipping");
    expect(categoryFor("Kosten voor Fulfillment by Amazon")).toBe("shipping");
    expect(categoryFor("Commissioni di Logistica di Amazon")).toBe("shipping");
    expect(categoryFor("Tarifas de logística de Amazon")).toBe("shipping");
    expect(categoryFor("Avgifter för Fraktas från Amazon")).toBe("shipping");
    expect(categoryFor("Frais d'expédition par Amazon")).toBe("shipping");
  });

  it("maps software subscriptions", () => {
    expect(categoryFor("sellerboard subscription (standard plan)")).toBe("software");
  });

  it("maps office supplies", () => {
    expect(categoryFor("Office Supply")).toBe("office");
    expect(categoryFor("Kitchen towel")).toBe("office");
  });

  it("maps eco-contribution levies to tax", () => {
    expect(categoryFor("EPR Pay on Behalf eco-contributions and service fees")).toBe("tax");
    expect(categoryFor("Contribuciones ecológicas y tarifas de servicio de RAP")).toBe("tax");
  });

  it("is case-insensitive", () => {
    expect(categoryFor("ADS")).toBe("advertising");
    expect(categoryFor("benzin")).toBe(categoryFor("Benzin"));
  });

  it("falls back to other for selling fees, fuel and leasing", () => {
    // Selling/commission fees have no fitting category in ExpenseCategory —
    // a `fees` value is a documented follow-up, deliberately out of scope.
    expect(categoryFor("Gebühren für Verkaufen bei Amazon")).toBe("other");
    expect(categoryFor("Benzin")).toBe("other");
    expect(categoryFor("Car leasing")).toBe("other");
  });

  it("falls back to other for blank or unknown input", () => {
    expect(categoryFor(undefined)).toBe("other");
    expect(categoryFor("")).toBe("other");
    expect(categoryFor("Something nobody mapped")).toBe("other");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/expenses/_lib/expenseCategory`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement it**

Create `src/app/dashboard/expenses/_lib/expenseCategory.ts`:

```typescript
import type { ExpenseCategory } from "@/types";

/**
 * Guess an expense category from its description.
 *
 * A German input-tax ledger has no category column, and Amazon localises each
 * fee description to the marketplace it came from — the same fulfilment fee
 * appears in German, English, Dutch, Italian, Spanish, Swedish and French
 * within one quarterly file. Without this every row imports as "other".
 *
 * Order matters: the first matching entry wins, so put the specific before the
 * general. `shipping` is checked before the selling-fee words because
 * "Commissioni di Logistica" contains both ideas.
 *
 * Pure module — no React/Supabase/Redux. The importer shows the resulting
 * breakdown before committing, so a wrong guess is visible, not silent.
 */
const RULES: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  ["advertising", ["ads", "werbung", "advertising", "publicidad", "annonsering"]],
  ["tax", ["epr", "eco-contribution", "ecológicas", "ecologicas", "contribuciones", "rap"]],
  ["software", ["subscription", "abonnement", "sellerboard", "software", "saas"]],
  ["shipping", [
    "versand", "fulfilment", "fulfillment", "logistik", "logistica", "logística",
    "fraktas", "expédition", "expedition", "spedizione", "verzending", "shipping",
    "container packing", "logistik provider",
  ]],
  ["office", ["office", "büro", "buero", "supply", "towel", "papier"]],
];

export function categoryFor(description: string | undefined): ExpenseCategory {
  const s = description?.trim().toLowerCase();
  if (!s) return "other";
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => s.includes(k))) return category;
  }
  return "other";
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/expenses/_lib/expenseCategory`
Expected: PASS. If "Commissioni di Logistica di Amazon" lands in the wrong bucket, check the rule ordering rather than adding a special case.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/expenses/_lib/expenseCategory.ts src/app/dashboard/expenses/_lib/expenseCategory.test.ts
git commit -m "feat(expenses): map multilingual descriptions to categories

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The expense import format registry

**Files:**
- Create: `src/app/dashboard/expenses/_components/expenseImportFormats.ts`
- Create: `src/app/dashboard/expenses/_components/expenseImportFormats.test.ts`

**Interfaces:**
- Consumes: `ALIASES`, `normalizeHeader`, `resolveHeaders`, `canonicalizeRow`, `ColumnSpec` (Task 2); `parseLocaleRate` (Task 2); `categoryFor` (Task 4); `parseLocaleNumber`, `parseFlexibleDate`, `type DateOrder` from `@/lib/utils/localeParse`.
- Produces, consumed by Task 6:
  ```typescript
  export type ExpenseImportFormatId = "generic" | "vorsteuer";
  export interface ExpenseImportFormat { id, label, columns: ColumnSpec[], classifiesSkips: boolean }
  export const EXPENSE_IMPORT_FORMATS: Record<ExpenseImportFormatId, ExpenseImportFormat>;
  export type ExpenseImportData = Omit<Expense, "id" | "created_by" | "created_at">;
  export type SkipReason = "blank row" | "summary row" | "zero amount" | "unsupported currency";
  export interface ParsedExpenseRow { rowNum: number; data: ExpenseImportData | null; error: string | null; skipped?: SkipReason }
  export function classifySkip(format, raw): SkipReason | null;
  export function validateExpenseRow(format, raw, rowNum, dateOrder?: DateOrder): ParsedExpenseRow;
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
import {
  EXPENSE_IMPORT_FORMATS,
  classifySkip,
  validateExpenseRow,
} from "./expenseImportFormats";

// A real row from the Q2-2026 Vorsteuerkonto.
const vorsteuerRow = {
  date: "13.04.2026",
  title: "Ads",
  vendor: "Amazon Online Germany GmbH",
  invoice_number: "1691682M5PA26",
  vendor_vat_number: "",
  tax_number: "",
  net_amount: "506.65",
  vat_rate: "19%",
  vat_amount: "96.26",
  amount: "602.91",
};

describe("vorsteuer — happy path", () => {
  it("parses a German dot date", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2026-04-13");
  });

  it("stores GROSS as amount and strips the percent from the rate", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow, 2);
    expect(row.data?.amount).toBe(602.91);
    expect(row.data?.vat_rate).toBe(19);
  });

  it("assigns a category from the description", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow, 2);
    expect(row.data?.category).toBe("advertising");
  });
});

describe("vorsteuer — VAT", () => {
  it("uses the file's vat_amount, never a derived one", () => {
    // 34.70 gross at a stated 19% would DERIVE 5.54 of VAT, but Amazon
    // actually charged 0.00 on this line. Deriving would invent tax.
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      title: 'Gebühren im Zusammenhang mit "Versand durch Amazon"',
      net_amount: "34.70",
      vat_rate: "19%",
      vat_amount: "0.00",
      amount: "34.70",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_amount).toBe(0);
  });

  it("errors when net + vat disagrees with gross beyond 2 cents", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      net_amount: "100.00",
      vat_amount: "19.00",
      amount: "150.00",
    }, 2);
    expect(row.error).toContain("does not reconcile");
  });

  it("tolerates a 2-cent rounding difference", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      net_amount: "100.00",
      vat_amount: "19.00",
      amount: "119.02",
    }, 2);
    expect(row.error).toBeNull();
  });
});

describe("vorsteuer — credit notes", () => {
  it("accepts a negative amount and negative VAT", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow,
      title: "Erstattung von Verkäufergebühren",
      net_amount: "-104.04",
      vat_amount: "-19.77",
      amount: "-123.81",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.amount).toBe(-123.81);
    expect(row.data?.vat_amount).toBe(-19.77);
  });
});

describe("vorsteuer — tax identifiers", () => {
  it("prefers the UStID", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, vendor_vat_number: "DE814584193", tax_number: "18/294/22775",
    }, 2);
    expect(row.data?.vendor_vat_number).toBe("DE814584193");
  });

  it("falls back to the Steuernummer per ROW when the UStID is blank", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, vendor_vat_number: "", tax_number: "18/294/22775",
    }, 2);
    expect(row.data?.vendor_vat_number).toBe("18/294/22775");
  });
});

describe("classifySkip — vorsteuer only", () => {
  it("skips the trailing Total row", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, date: "Total", title: "", vendor: "",
    })).toBe("summary row");
  });

  it("skips a zero-amount filler row", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, date: "", title: "Ads", net_amount: "0.00", vat_amount: "0.00", amount: "0",
    })).toBe("zero amount");
  });

  it("skips an unsupported currency", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, {
      ...vorsteuerRow, currency: "JPY",
    })).toBe("unsupported currency");
  });

  it("does not skip a real row", () => {
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.vorsteuer, vorsteuerRow)).toBeNull();
  });

  it("skips NOTHING for the generic format", () => {
    // The format guard must be the first statement in the function.
    expect(classifySkip(EXPENSE_IMPORT_FORMATS.generic, {
      date: "", title: "", amount: "0",
    })).toBeNull();
  });
});

describe("generic format", () => {
  it("still requires date, title and amount", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.generic, {
      date: "2026-01-15", title: "", amount: "10",
    }, 2);
    expect(row.error).toContain("title");
  });

  it("now accepts a German date and decimal comma", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.generic, {
      date: "15.01.2026", title: "Büromaterial", amount: "1.234,56",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2026-01-15");
    expect(row.data?.amount).toBe(1234.56);
  });

  it("still errors on a blank row instead of skipping it", () => {
    const row = validateExpenseRow(EXPENSE_IMPORT_FORMATS.generic, {
      date: "", title: "", amount: "",
    }, 2);
    expect(row.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/expenses/_components/expenseImportFormats`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the registry**

Create `src/app/dashboard/expenses/_components/expenseImportFormats.ts`.

Model it closely on `src/app/dashboard/sales/_components/importFormats.ts` — read that file first and follow its shape, naming and comment density.

The registry itself, verbatim:

```typescript
import type { Expense, ExpenseCategory, Currency } from "@/types";
import { ALIASES, resolveHeaders, canonicalizeRow, type ColumnSpec } from "@/lib/utils/importAliases";
import { parseLocaleNumber, parseLocaleRate, parseFlexibleDate, type DateOrder } from "@/lib/utils/localeParse";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { categoryFor } from "../_lib/expenseCategory";

// No re-export here. Sales re-exports these only because ImportSalesModal
// already imported them from its registry; the expenses modal is new code and
// imports them straight from @/lib/utils/importAliases.

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

export type ExpenseImportData = Omit<Expense, "id" | "created_by" | "created_at">;

export interface ParsedExpenseRow {
  rowNum: number;
  data: ExpenseImportData | null;
  error: string | null;
  skipped?: SkipReason;
}

const col = (key: string, required = false): ColumnSpec => ({
  key,
  aliases: ALIASES[key] ?? [key],
  required,
});

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
```

The requirements for `validateExpenseRow`:

- **`classifySkip`'s first statement must be the format guard**: `if (!format.classifiesSkips) return null;`. Putting any check above it makes `generic` inherit skip behaviour, which would silently swallow blank rows it must error on. This exact bug happened in the Sales module.
- Skip rules run in **exactly this order** — the order is load-bearing, because a real filler row matches more than one:

  ```typescript
  export function classifySkip(
    format: ExpenseImportFormat,
    raw: Record<string, string>,
  ): SkipReason | null {
    // MUST be first. See the gotcha in SKILL.md.
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
  ```
- Numbers use `parseLocaleNumber`; the rate uses `parseLocaleRate`; dates use `parseFlexibleDate(raw.date, dateOrder)` with `dateOrder` defaulting to `"dmy"`.
- **`amount` may be negative or zero.** Reject only a non-numeric value. Do not carry over the old `amount <= 0` rejection.
- `vat_amount` comes from the file when the column is present and parses; only when it is absent does the row derive it via `vatAmountFromGross(amount, vat_rate)`. A negative `amount` must yield a negative derived VAT, so guard the derivation accordingly or leave it null — never produce a positive VAT on a credit note.
- When `net_amount`, `vat_amount` and `amount` are all present, check `|net + vat − amount| <= 0.02` and fail the row with a message containing `does not reconcile` otherwise.
- `vendor_vat_number` is `raw.vendor_vat_number?.trim() || raw.tax_number?.trim() || null` — merged per row.
- `category` comes from `categoryFor(raw.title)` for `vorsteuer`. For `generic`, an explicit `category` column still wins and must validate against `ExpenseCategory`; fall back to `categoryFor` only when the column is absent.
- Round every money value to 2 decimals with a local `round2` helper, exactly as the Sales module does.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/expenses/_components/expenseImportFormats`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/expenses/_components/expenseImportFormats.ts src/app/dashboard/expenses/_components/expenseImportFormats.test.ts
git commit -m "feat(expenses): add the vorsteuer import format registry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the modal

**Files:**
- Modify: `src/app/dashboard/expenses/_components/ImportExpensesModal.tsx`

**Interfaces:**
- Consumes: everything Task 5 produces, plus `detectDateOrder`, `firstAmbiguousDate`, `hasOrderSensitiveDate` from `@/lib/utils/localeParse` if you add the date-order selector.

- [ ] **Step 1: Replace the validator with the registry**

Delete the local `validateRow`, `TEMPLATE_HEADERS`, `TEMPLATE_EXAMPLE`, `VALID_CATEGORIES`, `VALID_CURRENCIES` and the local `ParsedRow` interface (lines 16-74 and 24-28). Import from the registry instead, and add format state:

```typescript
const [formatId, setFormatId] = useState<ExpenseImportFormatId>("generic");
```

Keep the template-download button, sourcing its headers from `EXPENSE_IMPORT_FORMATS[formatId].columns.map((c) => c.key)`.

- [ ] **Step 2: Add the format dropdown**

Above the file drop zone, add a `Select` (from `@/components/ui/FormFields`) listing both formats by `label`. Changing it must re-run parsing on the already-loaded file, so hold the raw parsed rows in state (`parsedSource`) the way `ImportSalesModal.tsx` does, and re-derive on `formatId` change. Read that file's `parseAndValidate` and mirror its structure — including its run-id guard, which discards the result of a call superseded by a newer one before it resolves.

- [ ] **Step 3: Resolve headers and classify skips**

On parse: `resolveHeaders(rawHeaders, format.columns)` → if `missingRequired.length > 0`, show a file-level error naming the missing columns and stop. Otherwise `canonicalizeRow` each row, then for each row call `classifySkip` first and `validateExpenseRow` only when it returns null. Group skip reasons into counts for display, mirroring `skipReasonCounts` in `ImportSalesModal.tsx`.

- [ ] **Step 4: Show the category breakdown before import**

Below the "N rows ready" line, when `formatId === "vorsteuer"`, render a one-line summary of the categories the import will assign, sorted by count descending:

```tsx
{categoryCounts.length > 0 && (
  <p className="text-xs text-[var(--color-text-muted)]">
    Categories: {categoryCounts.map(([c, n]) => `${c} ${n}`).join(" · ")}
  </p>
)}
```

where `categoryCounts` is a `useMemo` over the valid rows' `data.category`. This is the whole point of guessing categories — a wrong guess must be visible before it lands.

- [ ] **Step 5: Let skips be non-fatal**

`canImport` currently requires `errors.length === 0 && validRows.length > 0`. Keep the zero-errors requirement, but skipped rows must not block the import — they are not errors and never enter `validRows`. Show the skip counts alongside the ready count, naming each reason.

- [ ] **Step 6: Ask the user to verify in the browser**

Do not start a dev server. Ask the user to import their Q2-2026 Vorsteuerkonto with the `vorsteuer` format selected and confirm: all 109 rows are accounted for as imported or skipped with a named reason; the 11 credit notes import as negative amounts; the four 19%-rate/€0.00-VAT rows keep `vat_amount` 0.00; and the category breakdown looks sane before import.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/expenses/_components/ImportExpensesModal.tsx
git commit -m "feat(expenses): add a format dropdown and category preview to import

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`
- Modify: `src/app/dashboard/sales/CLAUDE.md`

- [ ] **Step 1: `expenses/CLAUDE.md`**

Its "CSV import/export" section documents the old contract (`date` (YYYY-MM-DD), all-or-nothing, no formats). Rewrite it to cover: the two formats and how to pick one; the full `vorsteuer` column mapping table; gross → `amount`; file VAT winning over derived; the `net + vat ≈ gross` 0.02 check; per-row UStID/Steuernummer merging; skip classification; and negative amounts for credit notes. Add `_lib/expenseCategory.ts` and `_components/expenseImportFormats.ts` to the file map, and `lib/utils/importAliases` to the shared-deps list.

- [ ] **Step 2: `expenses/SKILL.md` gotchas**

Add:

> `classifySkip`'s format guard must be the FIRST statement. Anything above it makes `generic` inherit `vorsteuer`'s skip behaviour and silently swallow blank rows it is supposed to error on. This exact bug shipped once in the Sales module.

> `amount` may be negative — credit notes. Migration `032` dropped `expenses_amount_check`. Do not reintroduce an `amount <= 0` rejection; it would drop €218.14 of a single quarter's credit notes and leave the dashboard permanently adrift from the filed VAT return.

> The file's `vat_amount` wins over a derived one. Four real rows carry a 19% rate with €0.00 actual VAT, so deriving from the rate invents tax that was never charged.

> `vendor_vat_number` merges two columns per ROW, not per file. The ledger has both `UStID des Anbieters` and `Steuernummer` and fills whichever a vendor has; `resolveHeaders` maps one header per key, so they resolve to separate keys and merge in the validator.

> Headers are normalised by stripping a TRAILING parenthesised unit, so `Gross Amount (€)` matches the alias `gross amount`. Excel routinely mojibakes `€` to `â¬`, which would otherwise break matching.

- [ ] **Step 3: `sales/CLAUDE.md`**

Its `importFormats.ts` bullet says the module owns header-alias resolution. That moved to `lib/utils/importAliases.ts` in Task 2. Update the bullet and the shared-dependencies list, noting that `resolveHeaders`/`canonicalizeRow` are re-exported from `importFormats.ts` so existing call sites are unchanged.

- [ ] **Step 4: Ask the user to run the full gates and apply the migration**

```bash
npx tsc --noEmit && npm run lint && npx jest && uv run .claude/verifiers/verify_changes.py
```

Remind them that `032_expenses_allow_negative_amount.sql` and the updated `005_tenant_provisioning.sql` both need applying to Project B — the agent cannot, the MCP servers are read-only.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(expenses): document the vorsteuer import format

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Known limitations, carried from the spec

- **Amazon selling/commission fees land in `other`** (~25 rows per quarter). A `fees` category would ripple through `ExpenseCategory`, the DB check, `CategoryBadge` and the filters — deliberately out of scope.
- **`ImportPurchasesModal.tsx` still has the original defect.** Same ISO-only regex and `parseFloat`. It should adopt `importAliases.ts` on a separate branch.
- **Credit notes are not linked to the invoice they reverse.** No shared key exists — the credit note carries a different invoice number (`DE-CN-AEU-…` vs `DE-AEU-…`).
- **The modal has no automated test coverage**, as with Sales. All the testable logic lives in the pure modules; the wiring is verified by review and in the browser.
