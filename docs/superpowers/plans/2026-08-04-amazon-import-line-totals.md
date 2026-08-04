# Amazon Import — Line Totals, Shipping, VAT and Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Sales CSV importer accept a real Amazon VAT-transactions report — correcting line-total vs unit-price semantics, shipping-inclusive totals, fractional VAT rates, combined shipping VAT, and non-sale rows.

**Architecture:** The `amazon` entry in the existing format registry declares two semantic flags describing what its columns actually mean; `validateRowForFormat` branches on those flags instead of assuming generic semantics. Non-sale rows are classified as *skipped* (not errors) using the `ParsedRow.skipped` field that already exists for duplicate detection. RETURN rows parse into a flagged intent that the modal resolves against existing sales.

**Tech Stack:** TypeScript, Jest, Next.js App Router, Redux Toolkit, Supabase.

**Source spec:** `docs/superpowers/specs/2026-08-04-amazon-import-line-totals-design.md`

## Global Constraints

- **`total_amount` stores the ITEM line total only — never the sheet's `total` column.** `src/app/dashboard/_lib/aggregateSales.ts:25` computes `revenue = total_amount + shipping_charged`; writing the shipping-inclusive total there double-counts shipping.
- The sheet's `total` column is used **only** to validate `total ≈ total_amount + shipping_charged`, then discarded.
- **Unmatched returns must NEVER restock**, regardless of the per-import toggle. Restocking a sale the system never recorded creates inventory from nothing.
- `importFormats.ts` is a **pure module** — no React, Supabase or Redux imports. It is tested in `importFormats.test.ts`.
- The `generic` and `ebay` formats must keep their current behaviour **exactly**. Only `amazon` changes.
- German tolerance applies to all formats (decimal commas, `15.01.2024` dates) via `lib/utils/localeParse` — do not bypass `parseLocaleNumber` / `parseFlexibleDate`.
- **Never commit to `main`.** Work happens on `fix/amazon-import-line-totals` (already created off `main` @ `4ea9b01`).
- Do **not** run `npm test`, `npx tsc --noEmit`, `npm run lint`, or a dev server. You MAY run `npx jest src/app/dashboard/sales` for the files you touch. The user runs the full gates.
- Docs ship in the **same commit** as the code (AGENTS.md).
- Husky hooks enforce: `pre-commit` = `tsc --noEmit` + `eslint` + project verifier; `pre-push` = `jest` + `next build`.

## File structure

| File | Responsibility |
|---|---|
| `src/app/dashboard/sales/_components/importFormats.ts` | format flags, amazon column semantics, skip classification, RETURN parsing — **pure** |
| `src/app/dashboard/sales/_components/importFormats.test.ts` | all of the above, using real values from the April 2026 report |
| `src/app/dashboard/sales/_components/ImportSalesModal.tsx` | restock toggle, grouped skip reporting, RETURN match-and-update |
| `src/app/dashboard/sales/CLAUDE.md` + `SKILL.md` | file map + gotchas |

---

### Task 1: Format semantic flags + fractional VAT rate

Amazon writes `0.19` where the importer expects `19`. The current validator accepts `0 <= x <= 100`, so `0.19` passes and is stored as **0.19 %**. This imports silently wrong data and is the highest-severity defect in the spec.

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Produces: two optional fields on `ImportFormat` — `vatRateIsFraction?: boolean` and `priceColumnsAreLineTotals?: boolean`. Tasks 2–5 branch on them. Both default to `undefined` (falsy) so `generic` and `ebay` are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `importFormats.test.ts`:

```typescript
import { IMPORT_FORMATS, validateRowForFormat } from "./importFormats";

describe("amazon vat_rate is a fraction", () => {
  const amazon = IMPORT_FORMATS.amazon;

  it("declares the fraction flag", () => {
    expect(amazon.vatRateIsFraction).toBe(true);
    expect(IMPORT_FORMATS.generic.vatRateIsFraction).toBeFalsy();
    expect(IMPORT_FORMATS.ebay.vatRateIsFraction).toBeFalsy();
  });

  it("scales 0.19 to 19", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "306-4103530-5332345",
      date: "30-04-2026",
      product_name: "Baumwolltasche",
      quantity: "1",
      total: "9.89",
      unit_price: "9.89",
      currency: "EUR",
      vat_rate: "0.19",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_rate).toBe(19);
  });

  it("scales the Swedish 0.25 to 25", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "406-4012512-5663517",
      date: "08-04-2026",
      product_name: "Textilpennor",
      quantity: "1",
      total: "73.99",
      unit_price: "73.99",
      currency: "EUR",
      vat_rate: "0.25",
    }, 2);
    expect(row.data?.vat_rate).toBe(25);
  });

  it("leaves the generic format's 19 alone", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.generic, {
      date: "2026-04-30",
      product_name: "Widget",
      quantity: "1",
      unit_price: "9.89",
      vat_rate: "19",
    }, 2);
    expect(row.data?.vat_rate).toBe(19);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — `vatRateIsFraction` is not a property of `ImportFormat`, and `vat_rate` comes back as `0.19`.

- [ ] **Step 3: Add the flags to the interface**

In `importFormats.ts`, extend `ImportFormat` (currently around line 46):

```typescript
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
```

- [ ] **Step 4: Set both flags on the amazon format**

In `IMPORT_FORMATS.amazon` (around line 129), add after `columns: RICH_COLUMNS,`:

```typescript
    vatRateIsFraction: true,
    priceColumnsAreLineTotals: true,
```

Do **not** add these to `generic` or `ebay`.

- [ ] **Step 5: Scale the rate in the parser**

In `validateRowForFormat`, replace the vat_rate block (currently around line 298):

```typescript
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
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "fix(sales-import): scale Amazon fractional vat_rate to a percentage

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Line-total price semantics and the replaced total validation

This is the failure the user actually hit. `quantity × unit_price === total` is false for Amazon in two independent ways: the price column is a line total, and `total` includes shipping.

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Consumes: `priceColumnsAreLineTotals` from Task 1.
- Produces: for line-total formats, `data.unit_price = item_total / quantity` and `data.total_amount = item_total`. Task 3 reads `total_amount`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("amazon line totals", () => {
  const amazon = IMPORT_FORMATS.amazon;

  // Order 028-4502196-4511533 from the April 2026 report.
  it("derives a per-unit price from a line total at quantity 2", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "028-4502196-4511533",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "2",
      unit_price: "16.10",
      total: "16.10",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.unit_price).toBe(8.05);
    expect(row.data?.total_amount).toBe(16.10);
  });

  // Order 028-7135526-5060303: items 7.99 + shipping 2.00 = total 9.99.
  it("accepts a total that includes shipping, and stores items only", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "028-7135526-5060303",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      unit_price: "7.99",
      total: "9.99",
      shipping_charged: "2.00",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.unit_price).toBe(7.99);
    // CRITICAL: 7.99, not 9.99. aggregateSales adds shipping_charged on top,
    // so storing 9.99 here would report 11.99 revenue for a 9.99 order.
    expect(row.data?.total_amount).toBe(7.99);
    expect(row.data?.shipping_charged).toBe(2);
  });

  it("errors when total does not reconcile with items + shipping", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "7.99",
      total: "50.00",
      shipping_charged: "2.00",
      currency: "EUR",
    }, 2);
    expect(row.error).toContain("does not reconcile");
  });

  it("still enforces quantity x unit_price for the generic format", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.generic, {
      date: "2026-04-30",
      product_name: "Widget",
      quantity: "2",
      unit_price: "16.10",
      total: "16.10",
    }, 2);
    expect(row.error).toContain("disagrees with quantity");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — the first two error with `"total" (16.10) disagrees with quantity × unit_price (32.20)` and similar.

- [ ] **Step 3: Branch the price/total block**

In `validateRowForFormat`, replace the whole `if (totalRaw) { … } else { … }` block (currently around lines 257–290) with:

```typescript
  const totalRaw = raw.total?.trim();
  const unitPriceRaw = raw.unit_price?.trim();
  const shippingChargedRaw = raw.shipping_charged?.trim();
  let totalAmount: number;
  let unitPrice: number;

  if (format.priceColumnsAreLineTotals) {
    // Amazon: `unit_price` is the item LINE total (VAT incl) and `total` is
    // items + shipping. `total_amount` must hold items only — aggregateSales
    // computes revenue as total_amount + shipping_charged.
    // `unit_price` is OPTIONAL on this format. When it is absent the item
    // total must be BACKED OUT of the sheet total — `total` includes shipping,
    // so using it raw would store a shipping-inclusive figure in total_amount
    // and double-count shipping in revenue.
    const ship = shippingChargedRaw ? (parseLocaleNumber(shippingChargedRaw) ?? 0) : 0;
    const sheetTotal = totalRaw ? parseLocaleNumber(totalRaw) : null;
    if (totalRaw && (sheetTotal === null || sheetTotal <= 0)) {
      return fail(`"total" must be a positive number`);
    }

    let itemTotal: number | null;
    if (unitPriceRaw) {
      itemTotal = parseLocaleNumber(unitPriceRaw);
    } else if (sheetTotal !== null) {
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS. The generic-format test proves the old path is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "fix(sales-import): treat Amazon price columns as line totals

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Explicit vat_amount column

Amazon supplies the combined item + shipping VAT (1.28 + 0.32 = 1.60). Deriving it from a single rate is wrong whenever the shipping VAT rate differs from the item rate.

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Produces: a `vat_amount` alias group and column; `data.vat_amount` prefers the CSV value over the derived one.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("vat_amount column", () => {
  const amazon = IMPORT_FORMATS.amazon;

  // Order 028-7135526-5060303: item VAT 1.28 + shipping VAT 0.32 = 1.60.
  it("prefers the CSV vat_amount over deriving it", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "028-7135526-5060303",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      unit_price: "7.99",
      total: "9.99",
      shipping_charged: "2.00",
      vat_rate: "0.19",
      vat_amount: "1.60",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_amount).toBe(1.6);
  });

  it("still derives vat_amount when the column is absent", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "11.90",
      total: "11.90",
      vat_rate: "0.19",
      currency: "EUR",
    }, 2);
    expect(row.data?.vat_amount).toBeCloseTo(1.9, 1);
  });

  it("rejects a negative vat_amount", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "7.99",
      total: "7.99",
      vat_amount: "-1",
      currency: "EUR",
    }, 2);
    expect(row.error).toContain("vat_amount");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — the first returns the derived 1.28-ish value, not 1.60.

- [ ] **Step 3: Add the alias group**

In `ALIASES`, after the `vat_rate` line:

```typescript
  vat_amount: ["vat_amount", "vat_betrag", "mwst_betrag", "mwstbetrag", "steuerbetrag"],
```

- [ ] **Step 4: Add the column to RICH_COLUMNS and the headers**

In `RICH_COLUMNS`, after `col("vat_rate", false),`:

```typescript
  col("vat_amount", false),
```

In `RICH_HEADERS`, insert `"vat_amount"` immediately after `"vat_rate"`. Then add one extra value to BOTH rich `templateExample` arrays so they stay the same length as `RICH_HEADERS` — insert `"3,80"` into the amazon example and `"4,75"` into the ebay example, each immediately after their `"19"` entry.

- [ ] **Step 5: Read it in the parser**

Replace the derived-VAT line (currently `const vatAmount = vatRate ? vatAmountFromGross(totalAmount, vatRate) : null;`) with:

```typescript
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
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "feat(sales-import): map vat_amount explicitly for combined shipping VAT

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Skip classification for non-sale rows

Two thirds of a real Amazon report is not a sale. These must be *skipped and counted*, not errors — the importer is otherwise all-or-nothing and the file would never import.

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Produces:
  - `export type SkipReason = "blank row" | "summary row" | "not a sale" | "unsupported currency";`
  - `export function classifySkip(format: ImportFormat, raw: Record<string, string>): SkipReason | null`
  - `validateRowForFormat` returns `{ rowNum, data: null, error: null, skipped: <reason> }` for skipped rows.
  Task 6 groups these by reason in the modal.

- [ ] **Step 1: Write the failing tests**

```typescript
import { classifySkip } from "./importFormats";

describe("classifySkip", () => {
  const amazon = IMPORT_FORMATS.amazon;
  const sale = {
    order_id: "X", date: "30-04-2026", product_name: "W",
    quantity: "1", unit_price: "7.99", total: "7.99",
    currency: "EUR", status: "SALE",
  };

  it("passes a SALE row through", () => {
    expect(classifySkip(amazon, sale)).toBeNull();
  });

  it("skips a wholly blank row", () => {
    expect(classifySkip(amazon, { order_id: "", date: "", product_name: "", quantity: "" }))
      .toBe("blank row");
  });

  // The real file's trailing row puts "Total" in the FIRST column
  // (UNIQUE_ACCOUNT_IDENTIFIER), which is not mapped to any canonical key, and
  // scatters two stray numbers across unmapped columns. So it is NOT blank and
  // its order_id IS empty — detect it by the required fields all being empty.
  it("skips the trailing Total summary row", () => {
    expect(classifySkip(amazon, {
      order_id: "", date: "", product_name: "", quantity: "", total: "4.46",
    })).toBe("summary row");
  });

  it("does not mistake a real row missing only its date for a summary row", () => {
    expect(classifySkip(amazon, { ...sale, date: "" })).toBeNull();
  });

  it.each(["REFUND", "FC_TRANSFER"])("skips %s rows", (status) => {
    expect(classifySkip(amazon, { ...sale, status })).toBe("not a sale");
  });

  it("does NOT skip RETURN rows — they are handled as returns", () => {
    expect(classifySkip(amazon, { ...sale, status: "RETURN" })).toBeNull();
  });

  it("skips an unsupported currency", () => {
    expect(classifySkip(amazon, { ...sale, currency: "SEK" })).toBe("unsupported currency");
  });

  it("never skips rows for the generic format", () => {
    expect(classifySkip(IMPORT_FORMATS.generic, { ...sale, status: "REFUND" })).toBeNull();
    expect(classifySkip(IMPORT_FORMATS.generic, { ...sale, currency: "SEK" })).toBeNull();
  });

  it("marks the row skipped rather than errored via validateRowForFormat", () => {
    const row = validateRowForFormat(amazon, { ...sale, currency: "SEK" }, 7);
    expect(row.error).toBeNull();
    expect(row.data).toBeNull();
    expect(row.skipped).toBe("unsupported currency");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — `classifySkip` is not exported.

- [ ] **Step 3: Implement classifySkip**

Add above `validateRowForFormat`:

```typescript
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
  const values = Object.values(raw).map((v) => v?.trim() ?? "");
  if (values.every((v) => v === "")) return "blank row";

  // Only the amazon sheet carries non-sale rows; other formats keep their
  // existing all-or-nothing behaviour.
  if (!format.priceColumnsAreLineTotals) return null;

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
```

- [ ] **Step 4: Call it first in validateRowForFormat**

Insert immediately after the `fail` helper is defined, before the date parse:

```typescript
  const skipReason = classifySkip(format, raw);
  if (skipReason) {
    return { rowNum, data: null, error: null, skipped: skipReason };
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "feat(sales-import): skip non-sale Amazon rows instead of erroring

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: RETURN row parsing

RETURN rows identify an order and SKU but leave **every amount blank**, so they cannot go through normal amount validation.

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Produces: `ParsedRow.isReturn?: boolean`. Rows with it set carry `data.status === "returned"`, `data.restock === false`, and zeroed amounts. Task 7 reads `isReturn` and `sku` to match against existing sales.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("RETURN rows", () => {
  const amazon = IMPORT_FORMATS.amazon;

  // Order 304-7592975-1775530 from the April 2026 report — all amounts blank.
  const ret = {
    order_id: "304-7592975-1775530",
    date: "24-04-2026",
    product_name: "Textilstifte",
    quantity: "1",
    sku: "K2T-PFM-024",
    status: "RETURN",
    unit_price: "",
    total: "",
    currency: "",
  };

  it("parses despite every amount being blank", () => {
    const row = validateRowForFormat(amazon, ret, 3);
    expect(row.error).toBeNull();
    expect(row.isReturn).toBe(true);
  });

  it("zeroes the amounts and marks the sale returned", () => {
    const row = validateRowForFormat(amazon, ret, 3);
    expect(row.data?.status).toBe("returned");
    expect(row.data?.total_amount).toBe(0);
    expect(row.data?.unit_price).toBe(0);
    expect(row.data?.restock).toBe(false);
  });

  it("keeps the order id and sku for matching", () => {
    const row = validateRowForFormat(amazon, ret, 3);
    expect(row.data?.external_order_id).toBe("304-7592975-1775530");
    expect(row.sku).toBe("K2T-PFM-024");
  });

  it("does not mark ordinary SALE rows as returns", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X", date: "30-04-2026", product_name: "W",
      quantity: "1", unit_price: "7.99", total: "7.99",
      currency: "EUR", status: "SALE",
    }, 2);
    expect(row.isReturn).toBeFalsy();
    expect(row.data?.status).not.toBe("returned");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — the row errors with `"unit_price" (item line total) must be a positive number`.

- [ ] **Step 3: Add the flag to ParsedRow**

```typescript
export interface ParsedRow {
  rowNum: number;
  data: SaleImportData | null;
  error: string | null;
  /** Set by the modal's duplicate pre-check (I3) — row is valid but not imported. */
  skipped?: string | null;
  /** Raw SKU from the CSV — modal resolves this to product_id at insert time. */
  sku?: string | null;
  /**
   * Amazon RETURN row. The modal matches it to an existing sale by
   * external_order_id + resolved product and flips that sale's status;
   * when unmatched it inserts this row standalone. Amounts are all zero
   * because Amazon leaves every money column blank on RETURN rows.
   */
  isReturn?: boolean;
}
```

- [ ] **Step 4: Short-circuit RETURN rows in the parser**

Insert immediately after the `skipClassify` block from Task 4, before the date parse:

```typescript
  const isReturnRow =
    !!format.priceColumnsAreLineTotals && raw.status?.trim().toLowerCase() === "return";
```

Then, immediately after `quantity` has been validated (after `const quantity = quantityNum;`), insert:

```typescript
  if (isReturnRow) {
    // Amazon RETURN rows carry no money columns at all, so the normal amount
    // validation cannot run. Zero the amounts; the modal either flips an
    // existing sale's status or inserts this standalone.
    // `date`, `productName`, `platform` and `quantity` are already validated
    // above — do not re-parse them.
    const returnOrderId = raw.order_id?.trim() || null;
    if (!returnOrderId) return fail(`missing "order_id"`);
    return {
      rowNum,
      isReturn: true,
      sku: raw.sku?.trim() || null,
      error: null,
      data: {
        platform,
        product_name: productName,
        quantity,
        unit_price: 0,
        total_amount: 0,
        currency: "EUR",
        description: raw.description?.trim() || null,
        date,
        vat_rate: null,
        vat_amount: null,
        shipping_cost: null,
        shipping_charged: null,
        advertising_fee: null,
        status: "returned",
        // NEVER true here. An unmatched return has no corresponding sale, so
        // restocking it would create inventory from nothing. Task 7 applies
        // the per-import toggle only to returns that matched a real sale.
        restock: false,
        external_order_id: returnOrderId,
      },
    };
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "feat(sales-import): parse Amazon RETURN rows with zeroed amounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Modal — grouped skip reasons

`ImportSalesModal` already has a `skipped` count, but its label is hardcoded to "order already exists". With Task 4 there are now five distinct reasons and the user must see which.

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`

**Interfaces:**
- Consumes: `ParsedRow.skipped` (string) from Task 4.

- [ ] **Step 1: Group the skipped rows by reason**

Near the existing `const skipped = parsed.filter((r) => r.skipped);` (around line 90), add:

```typescript
  const skipReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of parsed) {
      if (!r.skipped) continue;
      counts.set(r.skipped, (counts.get(r.skipped) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed]);
```

- [ ] **Step 2: Replace the hardcoded skip label**

Replace the summary line (around line 326) that reads
`· {skipped.length} skipped (order already exists)` with:

```tsx
                {skipped.length > 0 && (
                  <span className="text-[var(--color-text-muted)]">
                    {" · "}{skipped.length} skipped
                    {" ("}
                    {skipReasonCounts.map(([reason, n]) => `${n} ${reason}`).join(", ")}
                    {")"}
                  </span>
                )}
```

- [ ] **Step 3: Fix the all-skipped message**

Replace the "All N rows skipped — these orders already exist." message (around line 333) with a reason-aware version:

```tsx
              <>
                All {skipped.length} row{skipped.length !== 1 ? "s" : ""} skipped —{" "}
                {skipReasonCounts.map(([reason, n]) => `${n} ${reason}`).join(", ")}.
              </>
```

- [ ] **Step 4: Ask the user to check it in the browser**

Do not start a dev server yourself. Ask the user to run `npm run dev`, open the Sales page, and import the April Amazon sheet — confirming the skip summary names the reasons (blank rows, not a sale, unsupported currency) rather than claiming they already exist.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/_components/ImportSalesModal.tsx
git commit -m "feat(sales-import): report skip reasons instead of assuming duplicates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Modal — return matching, update path and restock toggle

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`

**Interfaces:**
- Consumes: `ParsedRow.isReturn` and `ParsedRow.sku` (Task 5); the modal's existing `skuToProductId` map (around line 77).

- [ ] **Step 1: Add the restock toggle state**

Alongside the modal's other `useState` declarations:

```typescript
  // Amazon's report never says whether returned goods are resellable, so this
  // is a per-import choice. It applies ONLY to returns that matched an
  // existing sale — never to standalone unmatched returns.
  const [restockReturns, setRestockReturns] = useState(false);
```

- [ ] **Step 2: Render the toggle**

Place it next to the format selector, visible only when the parsed file contains returns:

```tsx
            {parsed.some((r) => r.isReturn) && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={restockReturns}
                  onChange={(e) => setRestockReturns(e.target.checked)}
                />
                Return stock to inventory for matched returns
              </label>
            )}
```

- [ ] **Step 3: Split returns from inserts in the submit handler**

In the handler that currently builds `payload` and calls `.insert(payload)` (around line 232), split the importable rows first:

```typescript
    const returnRows = importable.filter((r) => r.isReturn);
    const insertRows = importable.filter((r) => !r.isReturn);
```

- [ ] **Step 4: Resolve and apply matched returns**

Before the insert, add:

```typescript
    // Match each return on external_order_id + the product resolved from SKU.
    // Order ids are NOT unique in an Amazon sheet — a multi-line order such as
    // 028-6107376-1547566 appears once per SKU — so the product must be part
    // of the key or the wrong line gets flipped.
    const unmatchedReturns: typeof returnRows = [];
    for (const r of returnRows) {
      const orderId = r.data!.external_order_id;
      const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
      if (!orderId || !productId) {
        unmatchedReturns.push(r);
        continue;
      }
      const { data: match, error: matchErr } = await supabase
        .from("sales")
        .select("id")
        .eq("external_order_id", orderId)
        .eq("product_id", productId)
        .limit(1);
      if (matchErr) {
        setError("Could not check existing orders for returns. Please try again.");
        return;
      }
      if (!match || match.length === 0) {
        unmatchedReturns.push(r);
        continue;
      }
      const { error: updErr } = await supabase
        .from("sales")
        .update({ status: "returned", restock: restockReturns })
        .eq("id", match[0].id);
      if (matchErr || updErr) {
        setError("Could not update a returned order. Please try again.");
        return;
      }
    }
```

- [ ] **Step 5: Insert unmatched returns standalone, with restock forced false**

Build the insert payload from `insertRows` plus `unmatchedReturns`, forcing `restock: false` on the latter:

```typescript
    const payload = [
      ...insertRows.map((r) => {
        const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
        return { ...r.data!, created_by: user.id, product_id: productId };
      }),
      ...unmatchedReturns.map((r) => {
        const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
        // restock stays false: there is no matching sale, so returning this to
        // stock would create inventory the system never sold.
        return { ...r.data!, created_by: user.id, product_id: productId, restock: false };
      }),
    ];
```

- [ ] **Step 6: Record it in the audit metadata**

Extend the existing `writeAuditLog` metadata object (around line 249) with:

```typescript
        returns_matched: returnRows.length - unmatchedReturns.length,
        returns_unmatched: unmatchedReturns.length,
        restock_returns: restockReturns,
```

- [ ] **Step 7: Ask the user to verify in the browser**

Do not start a dev server. Ask the user to import the April sheet and confirm: matched returns flip an existing order to *returned*; unmatched returns appear as new zero-value returned orders; and with the toggle ON, inventory rises only for matched returns.

**Note on a spec test case that cannot be a unit test.** The spec asks for a
test proving a multi-line order (`028-6107376-1547566`, two SKUs) matches the
correct line rather than the first one sharing the order id. That logic lives in
this modal and needs Supabase, so it is not testable in the pure module. It is
covered by the `.eq("external_order_id", …).eq("product_id", …)` compound key in
Step 4 and must be confirmed in the browser here — import the April sheet and
check that the return against `K2T-PFM-024` does not flip the
`100-CNC-3842-5P` line of the same order.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/sales/_components/ImportSalesModal.tsx
git commit -m "feat(sales-import): match Amazon returns to existing sales

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `src/app/dashboard/sales/CLAUDE.md`
- Modify: `src/app/dashboard/sales/SKILL.md`
- Modify: `src/app/dashboard/purchases/CLAUDE.md`

- [ ] **Step 1: Sales CLAUDE.md**

Document the amazon format's two semantic flags, the `vat_amount` column, `classifySkip`, and the modal's return match-and-update path.

- [ ] **Step 2: Sales SKILL.md gotchas**

Add these four, each of which cost real debugging time:

> `total_amount` stores the ITEM line total, never the sheet's `total`. `aggregateSales.ts:25` computes revenue as `total_amount + shipping_charged`, so storing the shipping-inclusive total double-counts shipping.

> Amazon has no per-unit price column. Its `unit_price` is `TOTAL_PRICE_OF_ITEMS_AMT_VAT_INCL` — the whole line. The `priceColumnsAreLineTotals` flag drives the derivation.

> Amazon writes VAT rates as fractions (`0.19`). The old `0–100` check accepted that and stored 0.19 %. `vatRateIsFraction` scales it before range-checking.

> Order ids are not unique in an Amazon sheet — a multi-line order appears once per SKU. Return matching must key on `external_order_id` **and** the resolved product.

- [ ] **Step 3: Correct the purchases doc error**

`src/app/dashboard/purchases/CLAUDE.md` describes `total_amount` as "(generated column)". Verified live on 2026-08-04: `is_generated = NEVER` on both `sales.total_amount` and `purchases.total_amount` — they are plain writable `numeric(12,2) NOT NULL`. Correct the wording.

- [ ] **Step 4: Ask the user to run the full gates**

```bash
npx tsc --noEmit && npm run lint && npx jest && uv run .claude/verifiers/verify_changes.py
```

Report the actual output. Do not claim success without it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(sales): document Amazon import semantics and return matching

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Open decision for the user

**What fulfilment status should an Amazon `SALE` row get?** Amazon's `status`
column is a row *type* (SALE / RETURN / REFUND / FC_TRANSFER), not a fulfilment
state. Today `normalizeStatus("SALE")` falls through its synonym table and
returns the literal string `"sale"`, which is not a valid order status — a
pre-existing bug this plan does not fix.

This plan leaves that behaviour untouched so the change stays scoped. Fixing it
is a one-line addition to `STATUS_SYNONYMS` mapping `sale` to whichever status
you want (`delivered` is the most defensible, since the report only contains
completed transactions). Confirm the value and it can fold into Task 5.

## Known follow-ups (deliberately not in this plan)

- **SEK is skipped, not supported.** Swedish revenue does not import at all.
  Adding `SEK` to `Currency` touches `src/types/index.ts`, `formatCurrency`,
  the invoice generator and every currency dropdown. Recurs monthly.
- **REFUND rows carry real negative amounts** and are skipped entirely.
- **Standalone returned rows have no price data**, so order counts include rows
  that were never recorded as sales.
- **Unmatched returns never restock**, even with the toggle on — revisit once
  the standalone-row behaviour has been used in anger.
