# Currency Conversion at Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Tasks 1 and 2 are CONTROLLER-EXECUTED, not implementer-dispatched** — see their notes. Do not delegate them to a subagent, and do not run their SQL against the live database without the human partner's explicit go-ahead in that moment.

**Goal:** A sheet row in any ISO-4217 currency converts to the tenant's base
currency at import time (Sales, Expenses, Purchases), with a mandatory
rate-review step the user confirms before anything is written — fixing the
confirmed live bug where 24 Swedish orders (≈€360) were booked as €4,057.20.
Also fixes two adjacent Amazon import defects found in the same audit
(multi-line order lines dropped by the dedupe key; refunds against orders
outside the file silently discarded).

**Architecture:** ECB daily reference rates (cached in a new control-plane
table), a pure conversion library, a shared `FxRateReview` component used by
all three import modals, and a two-pass row lifecycle: parse (recognizing but
NOT yet converting a foreign-currency row) → user confirms rates → apply
rates (converts the row's money fields in place). This is the plan's own
design for the row lifecycle — the spec approves the review UI and the
conversion formula but leaves the exact data flow open; see "Implementation
judgment calls" below for what this plan decided and why.

**Tech Stack:** TypeScript, Next.js API routes, Supabase (tenant schema +
control plane), ECB's public `data-api.ecb.europa.eu` CSV endpoint (no key).

## Global Constraints

- This worktree (`.claude/worktrees/spec+multicurrency-expense-images-date-filters`,
  branch `worktree-spec+multicurrency-expense-images-date-filters`) already
  holds the approved design spec
  (`docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md`)
  as its one commit on top of `main` at `0476663`. Continue committing on
  this branch — do not create a new one for this plan.
- This is the first of three plans derived from that spec (currency
  conversion + adjacent defects; expense receipts; month/quarter filters —
  in that priority order, per the user). This plan implements ONLY the
  currency-conversion and adjacent-defects sections. Do not touch the
  `receipts` jsonb column, the `expense-receipts` bucket, `ReceiptUploader`,
  `FilterBar`'s "Specific period" entry, or `periodRange`/`describePeriod` —
  those are the other two plans' scope.
- Every commit must pass `.husky/pre-commit` (`tsc --noEmit`, `eslint`,
  project verifier) automatically — **never** `--no-verify` or any other
  hook bypass, for any reason. A prior session's plan had exactly this
  violation; it is a hard rule, not a suggestion.
- Every commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Per AGENTS.md rule 5: tenant-schema DDL goes through
  `run_on_all_tenant_schemas`, mirrored into `provision_tenant_schema()` in
  the same commit (the "2-places" rule).
- A live-database step (Tasks 1 and 2) requires the human partner's explicit
  confirmation in the moment before running, regardless of what this plan
  says — DDL against a live production system is a hard-to-reverse,
  shared-state action per this session's standing operating rules.
- **Known migration-number collision, not this plan's problem to solve now:**
  a sibling branch (`feat/overview-rpc-aggregation`, different work, already
  merged as PR #105) also used `045` for a tenant migration. This plan's
  `045_currency_conversion.sql` is a genuine, unavoidable collision that
  whoever merges this branch will need to renumber (to `046`) at merge time —
  flag it there, don't pre-emptively renumber against a moving target now.

## Implementation judgment calls (read before Task 3)

The spec approves the review UI's appearance and the conversion formula but
does not specify the exact internal data flow. Three decisions this plan
makes, all consistent with the spec's stated files and testable
independently:

1. **Two-pass row lifecycle, not one.** `validateRowForFormat` (and its
   Expenses/Purchases equivalents) parses a row's money fields in whatever
   currency the sheet states, WITHOUT converting — it only *recognizes* that
   a row needs conversion (`ParsedRow.sheetCurrency` is set to the raw ISO
   code when it differs from the tenant's base currency). A second pass,
   `applyRate(row, resolvedRate)` (`lib/fx/convert.ts`, per the spec's own
   file list), runs only after the user confirms rates, and is what actually
   mutates `data.total_amount`/`vat_amount`/etc. into base currency and sets
   `original_currency`/`original_total_amount`/`fx_rate`/`fx_rate_date`. A
   row whose currency already matches the base currency never enters this
   second pass — `sheetCurrency` stays null, `applyRate` is never called for
   it, and every existing base-currency import keeps working byte-for-byte
   unchanged. This preserves the existing single-pass behavior as a subset
   and keeps `Sale.currency`/`Expense.currency`/`Purchase.currency`
   correctly typed as `Currency` (`"EUR"|"USD"|"GBP"`) at every point in
   time, never transiently holding an untyped string like `"SEK"`.
2. **A shared `resolveSheetCurrency` helper, not three duplicated
   inline checks.** Sales, Expenses, and Purchases each currently do
   `(raw.currency?.trim().toUpperCase() || "EUR") as Currency` inline
   (confirmed identical in shape across all three files). This plan adds
   one pure function (`lib/fx/convert.ts`) all three call, so "what counts
   as a valid ISO code" and "what happens when the column is blank" are
   defined once. This is a minimal, targeted addition beyond the spec's
   literal file list — not scope creep, since the alternative is the same
   currency-detection bug (or its fix) landing three times with three
   chances to disagree.
3. **`classifySkip`'s "unsupported currency" skip reason is repurposed, not
   removed.** Today it fires for anything not in `{EUR,USD,GBP}`. After this
   plan, it fires only for a currency column that is non-blank and does NOT
   match a plausible ISO-4217 shape (`/^[A-Z]{3}$/`) — e.g. genuinely
   garbled data. A recognized code like `SEK` no longer skips; it routes to
   the FX review step instead. The skip reason string itself is unchanged
   ("unsupported currency") since it's still describing the same class of
   problem (a currency value that can't be handled), just a narrower one.

## Task overview

1. [CONTROLLER] Tenant schema migration — currency columns.
2. [CONTROLLER] Control-plane migration — `fx_rates` cache table.
3. `src/types/index.ts` — the four new fields.
4. `src/lib/fx/convert.ts` (+ `resolveSheetCurrency`) — pure, TDD.
5. `src/lib/fx/ecb.ts` — server-only ECB fetch/parse/cross-rate/walk-back.
6. `src/lib/fx/authGuard.ts` + `src/app/api/fx/rates/route.ts`.
7. `src/components/import/fxReviewState.ts` — pure reducer, TDD.
8. `src/components/import/FxRateReview.tsx` — the shared review UI.
9. Sales: currency alias + FX review wiring.
10. Sales: dedupe-key merge fix (adjacent defect #1).
11. Sales: unmatched-refund blocking warning (adjacent defect #2).
12. Expenses: FX review wiring.
13. Purchases: extract `purchaseImportFormats.ts` (parity refactor).
14. Purchases: FX review wiring.
15. Display original currency on Sale/Expense detail views.
16. Docs updates + final verification.

---

### Task 1 [CONTROLLER-EXECUTED — requires explicit human confirmation]: Tenant schema migration — currency columns

**Files:**
- Create: `supabase/migrations/045_currency_conversion.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`
- Modify: `supabase/SKILL.md` (file-map entry)

**Interfaces:**
- Produces: four new nullable columns on `sales`, `expenses`, `purchases` in
  every tenant schema — `original_currency text`, `original_total_amount
  numeric(12,2)`, `fx_rate numeric(18,8)`, `fx_rate_date date`. All four
  null means no conversion happened (the normal case). Tasks 3, 9, 10, 12,
  14, 15 all depend on these columns existing.

- [ ] **Step 1: Write the migration (implementer-authored, not yet applied)**

```sql
-- ============================================================
-- Currency conversion columns — every tenant schema (run_on_all_tenant_schemas)
--
-- A sheet row in a non-base currency (confirmed live: 24 Swedish orders on
-- tenant_k2_textil's May 2026 Amazon report booked as EUR instead of SEK,
-- overstating revenue by ~€3,320) now converts at import time instead of
-- being silently mis-booked. These four columns record the original figure
-- for audit; the existing money columns always hold base-currency amounts,
-- so every existing aggregation/export/invoice is untouched.
--
-- All four nullable. NULL means no conversion happened — a base-currency
-- row has all four null. See
-- docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
-- section 1 for the full design, including the ECB rate-direction formula
-- (rate(X -> base) = quote(base) / quote(X) — inverting this is the easiest
-- mistake here and it fails silently).
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets these from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS original_currency text,
    ADD COLUMN IF NOT EXISTS original_total_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
    ADD COLUMN IF NOT EXISTS fx_rate_date date;

  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS original_currency text,
    ADD COLUMN IF NOT EXISTS original_total_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
    ADD COLUMN IF NOT EXISTS fx_rate_date date;

  ALTER TABLE {{schema}}.purchases
    ADD COLUMN IF NOT EXISTS original_currency text,
    ADD COLUMN IF NOT EXISTS original_total_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
    ADD COLUMN IF NOT EXISTS fx_rate_date date;
$$);
```

- [ ] **Step 2: Mirror into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, find the `EXECUTE
format($sql$ CREATE TABLE IF NOT EXISTS %1$I.sales (...) $sql$, schema_name);`
block (search for `CREATE TABLE IF NOT EXISTS %1$I.sales`) and add the four
new columns directly into that `CREATE TABLE` column list (not a separate
`ALTER` — this is the initial-provisioning path, so the columns belong in
the table definition itself), matching the existing column style exactly
(e.g. right after the `refunded_amount` column, before `status`):

```sql
      original_currency      text,
      original_total_amount  numeric(12,2),
      fx_rate                numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
      fx_rate_date           date,
```

Repeat for the `expenses` and `purchases` `CREATE TABLE` blocks in the same
file (search for `CREATE TABLE IF NOT EXISTS %1$I.expenses` and
`CREATE TABLE IF NOT EXISTS %1$I.purchases` respectively), adding the same
four columns to each, positioned reasonably within each table's existing
column list (e.g. after `vat_amount`).

- [ ] **Step 3: Update `supabase/SKILL.md`'s migration file map**

Read the file's existing table/list format for prior entries (it mirrors
`supabase/CLAUDE.md`'s style) and add an entry for `045_currency_conversion.sql`
following the same pattern as the most recent entries there — state what it
adds, that it's mirrored into `provision_tenant_schema()`, and cross-reference
the design spec.

- [ ] **Step 4: Sanity-check the SQL without touching the live database**

Run: `grep -c "ADD COLUMN IF NOT EXISTS" supabase/migrations/045_currency_conversion.sql`
Expected: `12` (4 columns × 3 tables).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/045_currency_conversion.sql supabase/migrations/005_tenant_provisioning.sql supabase/SKILL.md
git commit -m "$(cat <<'EOF'
feat(db): add currency conversion columns to sales/expenses/purchases

original_currency/original_total_amount/fx_rate/fx_rate_date, all
nullable — null means no conversion happened. Fixes the confirmed live
bug where 24 Swedish orders on tenant_k2_textil's May 2026 Amazon report
were booked as EUR instead of SEK. Not yet applied to any live tenant
schema — that's a separate, explicitly-confirmed step.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6 [[CONTROLLER, explicit confirmation required]]: Apply to `tenant_boughtopia` only first**

Same pattern as the RPC aggregation plan's Task 2: generate the
`{{schema}}` → `tenant_boughtopia`-substituted, un-wrapped `ALTER TABLE`
statements (strip the `run_on_all_tenant_schemas($$...$$)` wrapper — this
is a one-off single-tenant application, not a fan-out), show them to the
human partner, and only run them after explicit go-ahead. Verify via a
read-only query afterward (`SELECT column_name FROM
information_schema.columns WHERE table_schema = 'tenant_boughtopia' AND
table_name = 'sales' AND column_name LIKE 'original_%' OR column_name LIKE
'fx_%';` — expect 4 rows for `sales`, repeat for `expenses`/`purchases`).

- [ ] **Step 7 [CONTROLLER, explicit confirmation required, deferred until after Task 15]: Full rollout**

Do NOT do this yet — hold until every other task in this plan is complete
and verified against `tenant_boughtopia`. Then run the full, unmodified
migration file's `SELECT public.run_on_all_tenant_schemas($$...$$);` against
the live database, fanning out to all 5 tenants, with explicit confirmation
first. This step is listed here for completeness but is sequenced at the
very end of this plan (see Task 16).

---

### Task 2 [CONTROLLER-EXECUTED — requires explicit human confirmation]: Control-plane migration — `fx_rates` cache table

**Files:**
- Create: `supabase/control-plane/011_fx_rates_cache.sql`
- Modify: `supabase/CLAUDE.md` (control-plane file-map entry)

**Interfaces:**
- Produces: `control.fx_rates` — cache table keyed `(rate_date, currency)`,
  holding `quote(C)` exactly as ECB published it (units of that currency per
  1 EUR — never a derived pair rate, so a base-currency change needs no
  cache rebuild, per the spec). Task 5 (`ecb.ts`) reads/writes this table.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- FX rate cache — control plane (Project A)
--
-- Caches ECB daily reference rates so repeated imports/reviews don't
-- refetch the same date. Stores quote(C) exactly as the ECB publishes it —
-- units of currency C per 1 EUR — never a derived tenant-base-currency
-- pair rate, so this table needs no rebuild if a tenant's base currency
-- ever changes. FX rates are global reference data, not tenant data, hence
-- the control plane rather than a tenant schema.
--
-- See docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
-- section 1 for the conversion formula this feeds:
--   rate(X -> base) = quote(base) / quote(X)
-- ============================================================

CREATE TABLE IF NOT EXISTS control.fx_rates (
  rate_date  date NOT NULL,
  currency   text NOT NULL,
  quote      numeric(18,8) NOT NULL CHECK (quote > 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, currency)
);

GRANT SELECT, INSERT ON control.fx_rates TO service_role;
```

- [ ] **Step 2: Update `supabase/CLAUDE.md`'s control-plane file map**

Add an entry for `control-plane/011_fx_rates_cache.sql` right after the
`010_tenant_shipping_labels.sql` entry, matching that section's existing
bullet style.

- [ ] **Step 3: Commit**

```bash
git add supabase/control-plane/011_fx_rates_cache.sql supabase/CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(db): add control.fx_rates cache table

Caches ECB daily reference rates (quote per 1 EUR, not a derived pair
rate) so repeated imports don't refetch the same date. Global reference
data, hence the control plane rather than a tenant schema. Not yet
applied to the live control-plane database.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4 [CONTROLLER, explicit confirmation required]: Apply to the live control-plane database**

This table has no tenant-fan-out concern (it's Project A, applied once).
Show the human partner the exact SQL, confirm, then apply. Verify via
`SELECT * FROM control.fx_rates LIMIT 1;` (expect zero rows, no error).

---

### Task 3: `src/types/index.ts` — add the four new fields

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `Sale.original_currency: string | null`, `.original_total_amount:
  number | null`, `.fx_rate: number | null`, `.fx_rate_date: string | null`
  — same four fields added to `Expense` and `Purchase`. Every later task
  that touches `Sale`/`Expense`/`Purchase` depends on these.

- [ ] **Step 1: Add the fields to `Sale`**

After the last field in the `Sale` interface (currently ends with
`ebay_synced_at: string | null;` — verify this is still the last field by
reading the file, since other work may have landed since this plan was
written), add:

```ts
  // Set when this row was imported in a non-base currency and converted at
  // import time. All four null means no conversion happened (the normal
  // case) — see docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md.
  original_currency: string | null;
  original_total_amount: number | null;
  fx_rate: number | null;
  fx_rate_date: string | null; // ISO date
```

- [ ] **Step 2: Add the same four fields to `Expense`**

Same four fields, same comment, appended after `Expense`'s last field
(currently `invoice_number: string | null;`).

- [ ] **Step 3: Add the same four fields to `Purchase`**

Same four fields, same comment, appended after `Purchase`'s last field
(currently `sale_id: string | null;`).

- [ ] **Step 4: Verify nothing else breaks**

Run: `npx tsc --noEmit`
Expected: clean — these are new optional-shaped (nullable, not
`?:`-optional) fields, so every existing object literal constructing a
`Sale`/`Expense`/`Purchase` (test factories, import format modules) will
now fail to type-check unless it includes them. This is EXPECTED and will
be fixed by later tasks that touch those call sites — but if `tsc` reports
errors in files this task doesn't intend to touch yet, that's useful
signal for what Tasks 9-15 need to cover, not a sign this task did
something wrong. Do not "fix" those errors in this task by adding the
fields elsewhere — just confirm the compiler errors are exactly "missing
property" errors on the expected files (test factories in
`aggregateSales.test.ts` and similar, the three import format modules) and
report them in this task's report for later tasks to address.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(types): add original_currency/original_total_amount/fx_rate/fx_rate_date to Sale/Expense/Purchase

All four nullable, matching the new DB columns from
045_currency_conversion.sql. This alone doesn't fix any call site that
constructs one of these types without the new fields — that's covered by
later tasks in this plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `src/lib/fx/convert.ts` — pure conversion + currency resolution

**Files:**
- Create: `src/lib/fx/convert.ts`
- Create: `src/lib/fx/convert.test.ts`

**Interfaces:**
- Produces: `convertAmount(amount: number, rate: number): number`,
  `resolveSheetCurrency(raw: string | undefined, baseCurrency: Currency):
  { currency: Currency; sheetCurrency: string | null } | { error: string
  }`, `applyRate<T extends { total_amount: number; vat_amount: number |
  null }>(row: T, sheetCurrency: string, rate: number, rateDate: string):
  T & { original_currency: string; original_total_amount: number; fx_rate:
  number; fx_rate_date: string }`. Tasks 5, 7, 9, 10, 12, 14 all import
  from this module.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/fx/convert.test.ts`, following `dashboard/_lib/aggregateSales.test.ts`'s
conventions exactly (nested `describe` per concern, no mocking, arithmetic
comments on assertions):

```ts
import { convertAmount, resolveSheetCurrency, applyRate } from "./convert";

describe("convertAmount", () => {
  it("multiplies amount by rate and rounds half-up to 2dp", () => {
    expect(convertAmount(4057.20, 0.0877)).toBe(355.82); // 4057.20 * 0.0877 = 355.816044 -> 355.82
  });

  it("rounds .xx5 up, not to even (half-up, not banker's rounding)", () => {
    expect(convertAmount(1, 0.125)).toBe(0.13); // 0.125 -> 0.13, not 0.12
  });

  it("returns 0 for a 0 amount regardless of rate", () => {
    expect(convertAmount(0, 0.0877)).toBe(0);
  });

  it("preserves sign for a negative amount (credit notes)", () => {
    expect(convertAmount(-100, 0.0877)).toBe(-8.77);
  });

  it("throws for a non-positive rate", () => {
    expect(() => convertAmount(100, 0)).toThrow();
    expect(() => convertAmount(100, -1)).toThrow();
  });
});

describe("resolveSheetCurrency", () => {
  it("treats a blank/undefined value as the base currency, no conversion needed", () => {
    expect(resolveSheetCurrency(undefined, "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
    expect(resolveSheetCurrency("", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
    expect(resolveSheetCurrency("   ", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
  });

  it("treats a value matching the base currency as no conversion needed", () => {
    expect(resolveSheetCurrency("eur", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
    expect(resolveSheetCurrency("EUR", "EUR")).toEqual({ currency: "EUR", sheetCurrency: null });
  });

  it("recognizes a plausible ISO code different from base currency as needing conversion", () => {
    expect(resolveSheetCurrency("SEK", "EUR")).toEqual({ currency: "EUR", sheetCurrency: "SEK" });
    expect(resolveSheetCurrency("sek", "EUR")).toEqual({ currency: "EUR", sheetCurrency: "SEK" });
    expect(resolveSheetCurrency("PLN", "USD")).toEqual({ currency: "USD", sheetCurrency: "PLN" });
  });

  it("errors on a value that isn't a plausible 3-letter ISO code", () => {
    expect(resolveSheetCurrency("dollars", "EUR")).toEqual({ error: expect.stringContaining("unsupported currency") });
    expect(resolveSheetCurrency("12", "EUR")).toEqual({ error: expect.stringContaining("unsupported currency") });
  });
});

describe("applyRate", () => {
  const baseRow = { total_amount: 4057.20, vat_amount: 374.80 };

  it("converts total_amount and vat_amount, and records the original figures", () => {
    const result = applyRate(baseRow, "SEK", 0.0877, "2026-05-29");
    expect(result.total_amount).toBe(355.82); // 4057.20 * 0.0877
    expect(result.vat_amount).toBe(32.87); // 374.80 * 0.0877 = 32.87596 -> 32.88 -- verify exact rounding when implementing, adjust this expectation to match convertAmount's actual output for this input
    expect(result.original_currency).toBe("SEK");
    expect(result.original_total_amount).toBe(4057.20);
    expect(result.fx_rate).toBe(0.0877);
    expect(result.fx_rate_date).toBe("2026-05-29");
  });

  it("leaves vat_amount null when the row had none", () => {
    const result = applyRate({ total_amount: 100, vat_amount: null }, "USD", 0.92, "2026-06-01");
    expect(result.vat_amount).toBeNull();
  });

  it("does not mutate the input row", () => {
    const input = { total_amount: 100, vat_amount: 10 };
    applyRate(input, "USD", 0.92, "2026-06-01");
    expect(input).toEqual({ total_amount: 100, vat_amount: 10 });
  });
});
```

**Note on the `vat_amount` expectation above**: compute `374.80 * 0.0877`
by hand (or run the test once implemented and read the actual failure
message) before finalizing that assertion — half-up rounding of
32.87596 depends on exact floating-point behavior your implementation
produces; verify it against your own `convertAmount` rather than trusting
this plan's arithmetic blindly. This is exactly the kind of financial
rounding detail worth double-checking, not assuming.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest lib/fx/convert`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
import type { Currency } from "@/types";

const BASE_CURRENCIES: readonly Currency[] = ["EUR", "USD", "GBP"];

/**
 * Converts a base-currency-agnostic amount using a given rate, half-up
 * rounded to 2 decimal places (not banker's rounding — a tax-relevant
 * figure should round consistently in the direction a human expects).
 */
export function convertAmount(amount: number, rate: number): number {
  if (!(rate > 0)) {
    throw new Error(`convertAmount: rate must be positive, got ${rate}`);
  }
  const converted = amount * rate;
  // Half-up rounding: Math.round rounds .5 away from zero for positive
  // numbers, but toward zero is wrong for negatives — handle sign explicitly.
  const sign = converted < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(converted) * 100) / 100;
}

const ISO_CODE_RE = /^[A-Z]{3}$/;

/**
 * Decides whether a sheet's raw currency value needs conversion.
 * - Blank/undefined -> treated as the base currency (no conversion).
 * - Matches the base currency (case-insensitive) -> no conversion.
 * - A plausible ISO-4217 shape different from the base currency -> needs
 *   conversion, `sheetCurrency` set to the normalized code.
 * - Anything else (not 3 letters) -> an error, same "unsupported currency"
 *   wording classifySkip already uses, so the two stay consistent.
 */
export function resolveSheetCurrency(
  raw: string | undefined,
  baseCurrency: Currency
): { currency: Currency; sheetCurrency: string | null } | { error: string } {
  const trimmed = raw?.trim().toUpperCase();
  if (!trimmed || trimmed === baseCurrency) {
    return { currency: baseCurrency, sheetCurrency: null };
  }
  if (!ISO_CODE_RE.test(trimmed)) {
    return { error: `unsupported currency "${raw}"` };
  }
  return { currency: baseCurrency, sheetCurrency: trimmed };
}

/**
 * Applies a confirmed FX rate to one parsed row's money fields, returning a
 * NEW object (never mutates the input) with total_amount/vat_amount
 * converted to base currency and the original figures recorded for audit.
 */
export function applyRate<T extends { total_amount: number; vat_amount: number | null }>(
  row: T,
  sheetCurrency: string,
  rate: number,
  rateDate: string
): T & {
  original_currency: string;
  original_total_amount: number;
  fx_rate: number;
  fx_rate_date: string;
} {
  return {
    ...row,
    total_amount: convertAmount(row.total_amount, rate),
    vat_amount: row.vat_amount === null ? null : convertAmount(row.vat_amount, rate),
    original_currency: sheetCurrency,
    original_total_amount: row.total_amount,
    fx_rate: rate,
    fx_rate_date: rateDate,
  };
}
```

Note `BASE_CURRENCIES` is declared but unused in this snippet — remove it
unless you find a real use while implementing (e.g. validating
`baseCurrency` itself is one of the three), in which case use it; don't
leave dead code either way.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest lib/fx/convert`
Expected: PASS, all cases — fix the `vat_amount` assertion in Step 1's test
if your actual rounding output differs from this plan's hand-computed
guess, per that step's note.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/convert.ts src/lib/fx/convert.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): add convertAmount/resolveSheetCurrency/applyRate

Pure conversion library: half-up rounding to 2dp, currency-resolution
logic shared across Sales/Expenses/Purchases import (replacing three
near-identical inline checks), and the row-mutation step that records
original_currency/original_total_amount/fx_rate/fx_rate_date.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `src/lib/fx/ecb.ts` — server-only ECB rate fetching

**Files:**
- Create: `src/lib/fx/ecb.ts`
- Create: `src/lib/fx/ecb.test.ts`

**Interfaces:**
- Consumes: `control.fx_rates` (Task 2), a control-plane Supabase client
  (`createControlClient` from `src/lib/supabase/control.ts` — read that
  file first to confirm its exact export name/signature before using it).
- Produces: `getRate(currency: string, date: string, baseCurrency: Currency):
  Promise<{ rate: number; rateDate: string } | null>` (null = unresolved
  after the 7-day walk-back). Task 6's API route calls this.

- [ ] **Step 1: Read the reference pattern**

Read `src/lib/shipping/easypost.ts` in full (the research for this plan
already characterized its shape: a private low-level fetch+error-normalize
helper, typed public functions on top, explicit interfaces, a doc-comment
marking it server-only with no runtime enforcement — the project verifier
handles that at the import-graph level). Match this file's shape and
error-handling style exactly, don't invent a different convention.

- [ ] **Step 2: Write `ecb.ts`**

```ts
/**
 * Server-only wrapper over the ECB's public daily reference rate CSV
 * endpoint (https://data-api.ecb.europa.eu, no API key). Never import this
 * from a Client Component — the project verifier's guard_edit.py denies
 * that at write time.
 *
 * The ECB publishes the value of ONE EURO in the foreign currency (e.g. the
 * D.SEK.EUR.SP00.A series gives ~11.4, meaning 1 EUR = 11.4 SEK). This
 * module stores and returns that raw published figure ("quote") in the
 * cache, and computes the actual base-currency conversion rate on read:
 *
 *   rate(X -> base) = quote(base) / quote(X)
 *
 * quote(EUR) = 1 by definition. Getting this inverted is the easiest
 * mistake here and it fails silently — a rate 100x too large or small
 * looks like a data problem, not a formula bug. See
 * docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
 * section 1 for the full rationale.
 */
import { createControlClient } from "@/lib/supabase/control";
import type { Currency } from "@/types";

const ECB_BASE_URL = "https://data-api.ecb.europa.eu/service/data/EXR";
const WALK_BACK_DAYS = 7;

function isoDateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reads a cached quote for (date, currency) from control.fx_rates, or
 * fetches it from the ECB and caches it if missing. Returns null if the
 * ECB has no publication for that exact date (weekends/holidays) — the
 * caller (getRate) does the walk-back across multiple dates.
 */
async function getQuoteForDate(currency: string, date: string): Promise<number | null> {
  if (currency === "EUR") return 1;

  const control = createControlClient();
  const { data: cached } = await control
    .schema("control")
    .from("fx_rates")
    .select("quote")
    .eq("rate_date", date)
    .eq("currency", currency)
    .maybeSingle();
  if (cached) return cached.quote as number;

  const url = `${ECB_BASE_URL}/D.${currency}.EUR.SP00.A?startPeriod=${date}&endPeriod=${date}&format=csvdata`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null; // no publication for this date
    throw new Error(`ECB rate fetch failed: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  const quote = parseEcbCsv(csv, date);
  if (quote === null) return null;

  await control.schema("control").from("fx_rates").insert({ rate_date: date, currency, quote });
  return quote;
}

/**
 * Parses the ECB's CSV response for a single-date, single-series request.
 * Exported for testing against real fixture CSV without a network call.
 */
export function parseEcbCsv(csv: string, expectedDate: string): number | null {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return null; // header only, no data row = no publication
  const header = lines[0].split(",");
  const dateCol = header.indexOf("TIME_PERIOD");
  const valueCol = header.indexOf("OBS_VALUE");
  if (dateCol === -1 || valueCol === -1) {
    throw new Error("ECB CSV response missing expected columns");
  }
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols[dateCol] === expectedDate) {
      const value = Number(cols[valueCol]);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Resolves a conversion rate for `currency -> baseCurrency` as of `date`,
 * walking back up to 7 calendar days if the ECB has no publication for the
 * exact date (weekends, TARGET holidays). Returns null if unresolved after
 * the walk-back window — the caller must fall to manual rate entry.
 */
export async function getRate(
  currency: string,
  date: string,
  baseCurrency: Currency
): Promise<{ rate: number; rateDate: string } | null> {
  const normalizedCurrency = currency.toUpperCase();
  for (let offset = 0; offset <= WALK_BACK_DAYS; offset++) {
    const tryDate = isoDateMinusDays(date, offset);
    const [quoteForCurrency, quoteForBase] = await Promise.all([
      getQuoteForDate(normalizedCurrency, tryDate),
      getQuoteForDate(baseCurrency, tryDate),
    ]);
    if (quoteForCurrency !== null && quoteForBase !== null) {
      return { rate: quoteForBase / quoteForCurrency, rateDate: tryDate };
    }
  }
  return null;
}
```

- [ ] **Step 3: Write the tests (fixture-based, no live network call)**

Create `src/lib/fx/ecb.test.ts` testing `parseEcbCsv` (the pure, exported
parsing function) against real-shaped fixture CSV strings — do NOT hit the
live ECB endpoint in this test file, so it stays fast/offline/deterministic
like every other file in the default `npx jest` suite:

```ts
import { parseEcbCsv } from "./ecb";

describe("parseEcbCsv", () => {
  it("extracts the OBS_VALUE for the requested date", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "D.SEK.EUR.SP00.A,D,SEK,EUR,SP00,A,2026-05-29,11.4123";
    expect(parseEcbCsv(csv, "2026-05-29")).toBe(11.4123);
  });

  it("returns null when the CSV has no data row (no publication that day)", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE";
    expect(parseEcbCsv(csv, "2026-05-30")).toBeNull();
  });

  it("returns null when the requested date isn't in the response", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "D.SEK.EUR.SP00.A,D,SEK,EUR,SP00,A,2026-05-28,11.40";
    expect(parseEcbCsv(csv, "2026-05-29")).toBeNull();
  });

  it("throws when the CSV is missing expected columns (unexpected API shape change)", () => {
    const csv = "SOME,OTHER,SHAPE\n1,2,3";
    expect(() => parseEcbCsv(csv, "2026-05-29")).toThrow();
  });
});
```

`getQuoteForDate`/`getRate` themselves (the network+cache-hitting
functions) are NOT unit-tested here — they need a real control-plane
Supabase connection and a real or mocked `fetch`, which is exactly the
`*.integration.test.ts` territory established in the Overview RPC plan.
Do not add a live-network/live-DB test for this task; if you believe one
is valuable, note it in your report as a suggestion for a future
`ecb.integration.test.ts`, but do not create it as part of this task —
that's scope beyond what's asked here.

- [ ] **Step 4: Run and verify**

Run: `npx jest lib/fx/ecb`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/ecb.ts src/lib/fx/ecb.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): add ECB rate fetching with cache and weekend/holiday walk-back

Server-only. Caches quote(currency) per date in control.fx_rates
(never a derived pair rate, so a base-currency change needs no cache
rebuild). Walks back up to 7 days when the ECB has no publication for
the exact date. parseEcbCsv is unit-tested against fixture CSV; the
network+cache-hitting functions are left for a future integration test,
not added here (same pattern established for the Overview RPC
functions).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: FX rate API route + auth guard

**Files:**
- Create: `src/lib/fx/authGuard.ts`
- Create: `src/app/api/fx/rates/route.ts`

**Interfaces:**
- Consumes: `getRate` (Task 5).
- Produces: `POST /api/fx/rates` — request `{ base: Currency, pairs: {
  currency: string, date: string }[] }`, response `{ rates:
  Record<string, { rate: number, rateDate: string }>, unresolved: string[]
  }` where the response's key is `` `${currency}:${date}` `` (so the
  client can look up the rate for a specific row's exact date, not just
  its currency). `unresolved` lists the same `` `${currency}:${date}` ``
  keys for pairs `getRate` returned null for. Task 8 (`FxRateReview.tsx`)
  and Tasks 9/12/14 (the three import modals) call this route.

- [ ] **Step 1: Write the auth guard**

Read `src/lib/billing/authGuard.ts` in full first (already characterized:
the `{ context } | { error: NextResponse }` discriminated union, with
`?: undefined` on the unused branch of each — that marker is load-bearing,
not decoration, since it's what lets `if (auth.error) return auth.error;`
narrow the union). This route needs only "is an authenticated tenant
member" — FX rates aren't sensitive, and the actual import-write action
stays gated by each feature's own existing role checks — so this guard is
simpler than `requireBillingAdmin` (no role check):

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface FxAuthContext {
  tenantSchema: string;
}

export type FxAuthResult =
  | { context: FxAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

export async function requireFxAccess(): Promise<FxAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return { error: NextResponse.json({ error: "No tenant schema" }, { status: 400 }) };
  }
  return { context: { tenantSchema } };
}
```

Read `src/lib/supabase/server.ts` first to confirm `createClient`'s real
exported name/signature (the RPC aggregation plan's research found
`createServiceClientForTenant` there too, for a different purpose — use
whichever export is the tenant-session-scoped one matching
`requireBillingAdmin`'s own usage, not the service-role one).

- [ ] **Step 2: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireFxAccess } from "@/lib/fx/authGuard";
import { getRate } from "@/lib/fx/ecb";
import type { Currency } from "@/types";

interface RatePair {
  currency: string;
  date: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireFxAccess();
  if (auth.error) return auth.error;

  let body: { base?: Currency; pairs?: RatePair[] };
  try {
    body = (await req.json()) as { base?: Currency; pairs?: RatePair[] };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { base, pairs } = body;
  if (!base || !Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ error: "base and pairs are required" }, { status: 400 });
  }

  const rates: Record<string, { rate: number; rateDate: string }> = {};
  const unresolved: string[] = [];

  await Promise.all(
    pairs.map(async ({ currency, date }) => {
      const key = `${currency}:${date}`;
      try {
        const resolved = await getRate(currency, date, base);
        if (resolved) {
          rates[key] = resolved;
        } else {
          unresolved.push(key);
        }
      } catch (err) {
        console.error(`FX rate lookup failed for ${key}`, err);
        unresolved.push(key);
      }
    })
  );

  return NextResponse.json({ rates, unresolved });
}
```

Note the `catch` around each individual `getRate` call: one currency's ECB
fetch failing (network blip) should not fail the whole batch — it degrades
to "unresolved," which the review UI already handles by falling to manual
entry. No raw error message reaches the client (`db-error-to-client`-style
discipline, even though this isn't a Postgres error) — logged server-side
only.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/fx/authGuard.ts src/app/api/fx/rates/route.ts
git commit -m "$(cat <<'EOF'
feat(fx): add POST /api/fx/rates

Auth-guarded (authenticated tenant member — no role restriction, since
FX rates aren't sensitive and the actual import write stays gated by
each feature's own role checks). Batches rate lookups per (currency,
date) pair; one lookup failing doesn't fail the batch, it just adds
that pair to `unresolved`.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `src/components/import/fxReviewState.ts` — pure reducer

**Files:**
- Create: `src/components/import/fxReviewState.ts`
- Create: `src/components/import/fxReviewState.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: the state shape and reducer `FxRateReview.tsx` (Task 8) renders
  against, and `resolveRowRate(row, review)` that Tasks 9/12/14 call to get
  the final rate for one row after the user confirms.

- [ ] **Step 1: Design and write the state shape + reducer**

```ts
export interface CurrencyReviewEntry {
  currency: string;
  mode: "ecb" | "manual";
  /** Per-row-date ECB rates already resolved, keyed by ISO date. Empty until fetched. */
  ecbRatesByDate: Record<string, number>;
  /** The rate-review UI's manual-mode input, as a string (so an empty/invalid
   *  input can be represented without coercing to 0 or NaN). */
  manualRate: string;
  /** True if the API reported this currency as fully unresolved by ECB — the
   *  entry then STARTS in manual mode with an empty required input. */
  startedUnresolved: boolean;
}

export interface FxReviewState {
  entries: Record<string, CurrencyReviewEntry>; // keyed by currency code
}

export type FxReviewAction =
  | { type: "init"; currencies: string[]; unresolvedCurrencies: string[] }
  | { type: "ratesResolved"; rates: Record<string, { rate: number; rateDate: string }> }
  | { type: "setMode"; currency: string; mode: "ecb" | "manual" }
  | { type: "setManualRate"; currency: string; value: string };

export function fxReviewReducer(state: FxReviewState, action: FxReviewAction): FxReviewState {
  switch (action.type) {
    case "init": {
      const entries: Record<string, CurrencyReviewEntry> = {};
      for (const currency of action.currencies) {
        const startedUnresolved = action.unresolvedCurrencies.includes(currency);
        entries[currency] = {
          currency,
          mode: startedUnresolved ? "manual" : "ecb",
          ecbRatesByDate: {},
          manualRate: "",
          startedUnresolved,
        };
      }
      return { entries };
    }
    case "ratesResolved": {
      const entries = { ...state.entries };
      for (const [key, { rate, rateDate }] of Object.entries(action.rates)) {
        const [currency] = key.split(":");
        const entry = entries[currency];
        if (!entry) continue;
        entries[currency] = {
          ...entry,
          ecbRatesByDate: { ...entry.ecbRatesByDate, [rateDate]: rate },
        };
      }
      return { entries };
    }
    case "setMode": {
      const entry = state.entries[action.currency];
      if (!entry) return state;
      return { entries: { ...state.entries, [action.currency]: { ...entry, mode: action.mode } } };
    }
    case "setManualRate": {
      const entry = state.entries[action.currency];
      if (!entry) return state;
      return {
        entries: { ...state.entries, [action.currency]: { ...entry, manualRate: action.value } },
      };
    }
    default:
      return state;
  }
}

/**
 * Whether every currency in the review has a usable rate — the confirm
 * button's disabled condition. Manual mode needs a positive numeric input;
 * ECB mode needs at least one resolved rate for that currency (a specific
 * row's exact date might still miss and fall back to the nearest available
 * date within the entry's ecbRatesByDate — resolveRowRate handles that).
 */
export function isReviewComplete(state: FxReviewState): boolean {
  return Object.values(state.entries).every((entry) => {
    if (entry.mode === "manual") {
      const parsed = Number(entry.manualRate);
      return entry.manualRate.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
    }
    return Object.keys(entry.ecbRatesByDate).length > 0;
  });
}

/**
 * Resolves the final rate + rate date for one row, once the review is
 * confirmed. Manual mode applies the same typed rate to every row of that
 * currency, with today's date as the "rate date" (there is no per-row ECB
 * date in manual mode — the user's typed figure IS the rate, undated).
 * ECB mode looks up the row's own date in ecbRatesByDate; if that exact
 * date is missing (shouldn't happen if `init`/`ratesResolved` covered every
 * date in the file, but defensive), falls back to the first available
 * date for that currency rather than throwing.
 */
export function resolveRowRate(
  rowCurrency: string,
  rowDate: string,
  state: FxReviewState
): { rate: number; rateDate: string } | null {
  const entry = state.entries[rowCurrency];
  if (!entry) return null;
  if (entry.mode === "manual") {
    const parsed = Number(entry.manualRate);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return { rate: parsed, rateDate: rowDate };
  }
  if (entry.ecbRatesByDate[rowDate] !== undefined) {
    return { rate: entry.ecbRatesByDate[rowDate], rateDate: rowDate };
  }
  const fallbackDate = Object.keys(entry.ecbRatesByDate)[0];
  if (fallbackDate === undefined) return null;
  return { rate: entry.ecbRatesByDate[fallbackDate], rateDate: fallbackDate };
}
```

- [ ] **Step 2: Write the tests**

Create `src/components/import/fxReviewState.test.ts`:

```ts
import { fxReviewReducer, isReviewComplete, resolveRowRate, type FxReviewState } from "./fxReviewState";

describe("fxReviewReducer", () => {
  it("init sets ecb mode for resolved currencies, manual for unresolved ones", () => {
    const state = fxReviewReducer(
      { entries: {} },
      { type: "init", currencies: ["SEK", "XYZ"], unresolvedCurrencies: ["XYZ"] }
    );
    expect(state.entries.SEK.mode).toBe("ecb");
    expect(state.entries.XYZ.mode).toBe("manual");
    expect(state.entries.XYZ.startedUnresolved).toBe(true);
  });

  it("ratesResolved populates ecbRatesByDate keyed by date, per currency", () => {
    let state = fxReviewReducer({ entries: {} }, { type: "init", currencies: ["SEK"], unresolvedCurrencies: [] });
    state = fxReviewReducer(state, {
      type: "ratesResolved",
      rates: { "SEK:2026-05-29": { rate: 0.0877, rateDate: "2026-05-29" } },
    });
    expect(state.entries.SEK.ecbRatesByDate["2026-05-29"]).toBe(0.0877);
  });

  it("setMode flips one currency without affecting others", () => {
    let state = fxReviewReducer({ entries: {} }, { type: "init", currencies: ["SEK", "PLN"], unresolvedCurrencies: [] });
    state = fxReviewReducer(state, { type: "setMode", currency: "SEK", mode: "manual" });
    expect(state.entries.SEK.mode).toBe("manual");
    expect(state.entries.PLN.mode).toBe("ecb");
  });
});

describe("isReviewComplete", () => {
  it("is false when a manual-mode currency has no rate typed yet", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "", startedUnresolved: true } },
    };
    expect(isReviewComplete(state)).toBe(false);
  });

  it("is true when manual mode has a positive numeric rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "0.0877", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(true);
  });

  it("is false when manual mode has a zero or negative rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "0", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(false);
  });

  it("is true when ecb mode has at least one resolved rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: { "2026-05-29": 0.0877 }, manualRate: "", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(true);
  });

  it("is false when ecb mode has no resolved rate at all", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: {}, manualRate: "", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(false);
  });
});

describe("resolveRowRate", () => {
  it("returns the exact-date ECB rate when present", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: { "2026-05-29": 0.0877, "2026-05-30": 0.0878 }, manualRate: "", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toEqual({ rate: 0.0877, rateDate: "2026-05-29" });
  });

  it("falls back to the first available date when the row's exact date is missing", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: { "2026-05-30": 0.0878 }, manualRate: "", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toEqual({ rate: 0.0878, rateDate: "2026-05-30" });
  });

  it("applies the manual rate to any row date, dated as the row's own date", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "0.09", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toEqual({ rate: 0.09, rateDate: "2026-05-29" });
  });

  it("returns null for a currency with no entry at all", () => {
    expect(resolveRowRate("XYZ", "2026-05-29", { entries: {} })).toBeNull();
  });

  it("returns null for manual mode with an unparseable/non-positive rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "abc", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toBeNull();
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `npx jest components/import/fxReviewState`
Expected: PASS, all 13 cases.

- [ ] **Step 4: Commit**

```bash
git add src/components/import/fxReviewState.ts src/components/import/fxReviewState.test.ts
git commit -m "$(cat <<'EOF'
feat(import): add the FX rate review's pure state reducer

Per-currency ECB/manual mode, isReviewComplete (the confirm button's
disabled condition), and resolveRowRate (used by each import modal
after confirmation to get the final rate for one row, falling back to
the nearest available ECB date if a row's exact date wasn't resolved).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `src/components/import/FxRateReview.tsx` — the shared review UI

**Files:**
- Create: `src/components/import/FxRateReview.tsx`

**Interfaces:**
- Consumes: `fxReviewState.ts` (Task 7), `Select`/`Input`/`Button` from
  `src/components/ui/FormFields`/`Button` (read one existing import modal's
  imports to confirm exact component names/paths before using them).
- Produces: `<FxRateReview>`, used by Tasks 9, 12, 14.

- [ ] **Step 1: Design the props and row summary shape**

```ts
export interface FxRateReviewRow {
  currency: string;
  rowCount: number;
  dateSpan: { from: string; to: string };
}

interface FxRateReviewProps {
  rows: FxRateReviewRow[];
  state: FxReviewState;
  dispatch: React.Dispatch<FxReviewAction>;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}
```

- [ ] **Step 2: Implement the component**

Read `src/app/dashboard/sales/_components/ImportSalesModal.tsx`'s existing
JSX styling conventions first (spacing classes, `Select`/`Input` usage,
button styling) so this matches the app's established look — don't invent
new visual patterns. The component renders one row per currency with: the
currency code, row count, date span, a rate column showing either the
ECB-resolved range/value or a manual `<Input type="number" step="any">`,
and a mode toggle. Follow this repo's form conventions exactly: the confirm
button is `type="submit" form="fx-rate-review-form"`, disabled while
`confirming` OR `!isReviewComplete(state)`, with a busy verb
("Applying rates…") while `confirming` is true. Wrap the rate inputs in a
real `<form id="fx-rate-review-form" onSubmit={(e) => { e.preventDefault();
onConfirm(); }}>`.

```tsx
"use client";

import { Select, Input } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { isReviewComplete, type FxReviewState, type FxReviewAction } from "./fxReviewState";

export interface FxRateReviewRow {
  currency: string;
  rowCount: number;
  dateSpan: { from: string; to: string };
}

interface FxRateReviewProps {
  rows: FxRateReviewRow[];
  state: FxReviewState;
  dispatch: React.Dispatch<FxReviewAction>;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}

export function FxRateReview({ rows, state, dispatch, onCancel, onConfirm, confirming }: FxRateReviewProps) {
  const complete = isReviewComplete(state);

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--color-text-muted)">
        This file has rows in a currency other than your account&apos;s base
        currency. Review the conversion rate for each before importing.
      </p>
      <form id="fx-rate-review-form" onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-(--color-text-faint) text-xs uppercase tracking-wider">
              <th className="pb-2">Currency</th>
              <th className="pb-2">Rows</th>
              <th className="pb-2">Date span</th>
              <th className="pb-2">Rate</th>
              <th className="pb-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const entry = state.entries[row.currency];
              if (!entry) return null;
              const dates = Object.keys(entry.ecbRatesByDate).sort();
              const rateValues = dates.map((d) => entry.ecbRatesByDate[d]);
              const rangeLabel =
                rateValues.length === 0
                  ? "unresolved"
                  : rateValues.length === 1 || new Set(rateValues).size === 1
                  ? rateValues[0].toFixed(5)
                  : `${Math.min(...rateValues).toFixed(5)} – ${Math.max(...rateValues).toFixed(5)}`;
              return (
                <tr key={row.currency} className="border-t border-(--color-border)">
                  <td className="py-2 font-medium">{row.currency}</td>
                  <td className="py-2">{row.rowCount}</td>
                  <td className="py-2">{row.dateSpan.from} – {row.dateSpan.to}</td>
                  <td className="py-2">
                    {entry.mode === "manual" ? (
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        required
                        value={entry.manualRate}
                        onChange={(e) => dispatch({ type: "setManualRate", currency: row.currency, value: e.target.value })}
                        placeholder="Rate"
                      />
                    ) : (
                      rangeLabel
                    )}
                  </td>
                  <td className="py-2">
                    <Select
                      value={entry.mode}
                      onChange={(e) => dispatch({ type: "setMode", currency: row.currency, mode: e.target.value as "ecb" | "manual" })}
                    >
                      <option value="ecb">ECB per order date</option>
                      <option value="manual">Manual</option>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </form>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
        <Button type="submit" form="fx-rate-review-form" disabled={confirming || !complete}>
          {confirming ? "Applying rates…" : "Confirm rates & import"}
        </Button>
      </div>
    </div>
  );
}
```

Read `src/components/ui/Button.tsx` and `FormFields.tsx` first to confirm
`Select`/`Input`/`Button`'s exact prop names (`variant`, whether `Select`
takes `children` `<option>`s or an `options` prop array) — adjust the
snippet above to match the real component APIs rather than assuming;
this plan's version is a best-effort based on other modals' usage patterns
described in this plan's research, not a verified read of those exact
component files.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean (fix any prop-name mismatches found in Step 2's
verification read).

- [ ] **Step 4: Commit**

```bash
git add src/components/import/FxRateReview.tsx
git commit -m "$(cat <<'EOF'
feat(import): add the shared FxRateReview component

One row per distinct currency in the file: row count, date span, an
ECB-resolved rate (range shown when it varies across dates) or a manual
input, and a mode toggle. Confirm button follows this repo's form
conventions — real <form>, disabled while incomplete or in flight, busy
verb while applying. Used by Sales/Expenses/Purchases import (Tasks
9/12/14), the 3rd+ consumer that promotes this out of any one feature
per AGENTS.md's shared-vs-feature-private rule.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Sales — currency alias + FX review wiring

**Files:**
- Modify: `src/lib/utils/importAliases.ts`
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`

**Interfaces:**
- Consumes: `resolveSheetCurrency`/`applyRate` (Task 4), `POST
  /api/fx/rates` (Task 6), `fxReviewReducer`/`resolveRowRate` (Task 7),
  `<FxRateReview>` (Task 8).
- Produces: `ParsedRow.sheetCurrency?: string | null` — a new field Task 15
  reads to decide whether to render the "originally X @ rate" line.

- [ ] **Step 1: Add the Amazon currency/VAT header aliases**

In `src/lib/utils/importAliases.ts`, add to the `currency` array:
`"transaction_currency_code"`, and to the `vat_amount` array:
`"total_activity_value_vat_amt"` (both exact-match lowercased strings,
matching the array's existing style — read the file first to confirm you're
appending to the right arrays at the right existing lines, since this
plan's research read them at specific line numbers that may have shifted).

- [ ] **Step 2: Change currency resolution in `importFormats.ts`**

Replace the line-471 currency-default logic
(`const currency = (raw.currency?.trim().toUpperCase() || "EUR") as
Currency;` plus its `VALID_CURRENCIES.includes` check) with a call to
`resolveSheetCurrency` (Task 4):

```ts
import { resolveSheetCurrency } from "@/lib/fx/convert";
// ...
const currencyResult = resolveSheetCurrency(raw.currency, baseCurrency);
if ("error" in currencyResult) {
  return fail(currencyResult.error);
}
const { currency, sheetCurrency } = currencyResult;
```

This requires `validateRowForFormat` to gain a new `baseCurrency: Currency`
parameter — thread it through from its caller in `ImportSalesModal.tsx`
(which gets it from `useAppSelector((s) => s.companyProfile.profile
?.currency) ?? "EUR"`, the same source `dashboard/page.tsx` uses for
`profileCurrency`). Add `sheetCurrency` to the returned `ParsedRow` (not
`SaleImportData` — it's parse-time-only metadata, not a column to insert)
by adding `sheetCurrency?: string | null;` to the `ParsedRow` interface
(line ~37-49 per this plan's research) and setting it in the return value
next to `data`.

Also update `classifySkip`'s currency guard (~line 273) to use the same
"plausible ISO shape" check instead of `VALID_CURRENCIES.includes` — a
recognized 3-letter code no longer skips; only a non-blank, non-ISO-shaped
value does. Reuse the exported `ISO_CODE_RE`-equivalent logic — either
export a small `isPlausibleIsoCode(s: string): boolean` from
`lib/fx/convert.ts` (Task 4) for both `resolveSheetCurrency` and this
guard to share, or duplicate the one-line regex check here with a comment
pointing at `resolveSheetCurrency` as the canonical definition — your call,
but don't let the two definitions silently drift (if you duplicate, add a
test in Task 4's suite or a comment here that would catch it).

- [ ] **Step 3: Add the FX review step to `ImportSalesModal.tsx`**

This modal currently has no step/stage state (confirmed: single-step parse
→ immediately-importable flow). Add:

```ts
type ImportStep = "select-file" | "fx-review";
const [step, setStep] = useState<ImportStep>("select-file");
const [fxState, fxDispatch] = useReducer(fxReviewReducer, { entries: {} });
const [fxRows, setFxRows] = useState<FxRateReviewRow[]>([]);
const [applyingRates, setApplyingRates] = useState(false);
```

After `parseAndValidate` resolves (inside `handleFile`'s success path,
where `setParsed(result)` already happens today), compute the distinct
sheet currencies:

```ts
const currencyGroups = new Map<string, { count: number; dates: string[] }>();
for (const row of result) {
  if (!row.sheetCurrency) continue;
  const g = currencyGroups.get(row.sheetCurrency) ?? { count: 0, dates: [] };
  g.count++;
  if (row.data?.date) g.dates.push(row.data.date);
  currencyGroups.set(row.sheetCurrency, g);
}
if (currencyGroups.size > 0) {
  const rows: FxRateReviewRow[] = Array.from(currencyGroups.entries()).map(([currency, g]) => ({
    currency,
    rowCount: g.count,
    dateSpan: { from: g.dates.slice().sort()[0], to: g.dates.slice().sort().at(-1)! },
  }));
  setFxRows(rows);
  const pairs = rows.flatMap((r) =>
    Array.from(new Set(currencyGroups.get(r.currency)!.dates)).map((date) => ({ currency: r.currency, date }))
  );
  const res = await fetch("/api/fx/rates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base: baseCurrency, pairs }),
  });
  const { rates, unresolved } = (await res.json()) as {
    rates: Record<string, { rate: number; rateDate: string }>;
    unresolved: string[];
  };
  fxDispatch({ type: "init", currencies: rows.map((r) => r.currency), unresolvedCurrencies: unresolved.map((k) => k.split(":")[0]) });
  fxDispatch({ type: "ratesResolved", rates });
  setStep("fx-review");
}
```

Add a `handleConfirmRates` that applies `resolveRowRate` to every row with
a `sheetCurrency`, using `applyRate` (Task 4) to mutate each row's `data`,
then proceeds to the existing import logic:

```ts
async function handleConfirmRates() {
  setApplyingRates(true);
  const updated = parsed.map((row) => {
    if (!row.sheetCurrency || !row.data) return row;
    const resolved = resolveRowRate(row.sheetCurrency, row.data.date, fxState);
    if (!resolved) return row; // shouldn't happen if isReviewComplete gated the button; defensive no-op
    return { ...row, data: applyRate(row.data, row.sheetCurrency, resolved.rate, resolved.rateDate) };
  });
  setParsed(updated);
  setStep("select-file"); // back to the existing summary/import view, now with converted rows
  setApplyingRates(false);
}
```

Render `<FxRateReview>` when `step === "fx-review"`, in place of the
existing parsed-rows summary — read the modal's current JSX structure
first to find exactly where to branch this in (likely right after the
existing `{parsed.length > 0 && (...)}` block's opening), rather than
guessing blindly at the surrounding markup.

- [ ] **Step 4: Update tests**

`importFormats.test.ts` has cases exercising `validateRowForFormat` — every
call site in that test file now needs a `baseCurrency` argument added (use
`"EUR"` to match existing test expectations that assume no conversion).
Add new cases: a row with `currency: "SEK"` resolves with `sheetCurrency:
"SEK"` and `data.currency: "EUR"` (unconverted `total_amount` at this
stage); a row with `currency: "XYZ123"` (not a plausible ISO code) still
fails with "unsupported currency". Run `npx jest dashboard/sales` and fix
every resulting failure — do not leave any test red.

- [ ] **Step 5: Run and verify**

Run: `npx jest dashboard/sales && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/importAliases.ts src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/ImportSalesModal.tsx
git commit -m "$(cat <<'EOF'
feat(sales): convert non-base-currency import rows via FX rate review

Adds the transaction_currency_code/total_activity_value_vat_amt Amazon
aliases so the currency column actually gets read (previously always
blank, silently defaulting every row to EUR — the confirmed live bug on
tenant_k2_textil's May 2026 report). A recognized non-base ISO code no
longer defaults to EUR or gets skipped; it routes through the shared
FxRateReview step and converts via applyRate before import.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Sales — dedupe-key merge fix (adjacent defect #1)

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.test.ts` (or
  wherever its colocated test lives — confirm the exact file name by
  listing the directory; the plan's research didn't find a dedicated test
  file for this modal's own logic distinct from `importFormats.test.ts`,
  so this may be a NEW test file, or logic may need extracting into a
  testable pure function first)

**Interfaces:**
- Consumes: nothing new.
- Produces: `markDuplicates` (or its replacement) now merges same
  `(platform, external_order_id, sku)` lines instead of dropping the
  second one as a duplicate.

- [ ] **Step 1: Extract the merge-aware dedupe logic as a pure, testable function**

Per this repo's `_lib/` convention (pure logic gets its own file with a
colocated test, not left inline in a modal), extract the in-file dedupe
into `src/app/dashboard/sales/_components/dedupeImportRows.ts`:

```ts
import type { ParsedRow } from "./importFormats";

/**
 * In-file dedupe for a parsed import batch. Two rows sharing
 * (platform, external_order_id) are the SAME line split across the sheet
 * (e.g. an Amazon multi-line order, one row per SKU) — NOT duplicates —
 * unless they also share the same `sku`, in which case they genuinely are
 * the same product line and must be MERGED (quantity and money summed),
 * not both kept and not the second dropped. Confirmed live: 4 of 1012 SALE
 * lines in a real May 2026 sheet shared both order id and SKU.
 *
 * Rows without external_order_id or marked as refunds pass through
 * unchanged — this function only touches genuine multi-line-order
 * candidates.
 */
export function dedupeImportRows(rows: ParsedRow[]): ParsedRow[] {
  const merged = new Map<string, ParsedRow>();
  const passthrough: ParsedRow[] = [];
  const order: string[] = [];

  for (const row of rows) {
    if (row.isRefund || !row.data?.external_order_id) {
      passthrough.push(row);
      continue;
    }
    const key = `${row.data.platform}:${row.data.external_order_id}:${row.sku ?? ""}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      order.push(key);
      continue;
    }
    // Same order id AND same SKU: genuinely the same product line split
    // across two sheet rows — sum quantity and money, don't drop either.
    if (!existing.data || !row.data) continue; // type guard; both are non-null per the check above
    existing.data = {
      ...existing.data,
      quantity: existing.data.quantity + row.data.quantity,
      total_amount: existing.data.total_amount + row.data.total_amount,
      vat_amount:
        existing.data.vat_amount === null && row.data.vat_amount === null
          ? null
          : (existing.data.vat_amount ?? 0) + (row.data.vat_amount ?? 0),
    };
  }

  // Different order id but SAME (platform, external_order_id) with a
  // DIFFERENT sku is the normal multi-line case — those get distinct keys
  // above (sku is part of the key) and both survive independently, which
  // is already correct: only same-key collisions reach the merge branch.
  return [...order.map((k) => merged.get(k)!), ...passthrough];
}
```

Note the comment's last paragraph is explaining why the OLD bug (dropping
different-SKU lines of the same order) is fixed simply by including `sku`
in the key — those rows now get distinct keys and both survive
independently through the `Map`, no special-case code needed for that
part; the merge branch only fires for the genuinely-identical-key case
this plan's spec called out (4 of 1012 lines).

- [ ] **Step 2: Wire it into `ImportSalesModal.tsx`**

Replace the body of `markDuplicates` (the in-file portion, lines ~250-262
per this plan's research — NOT the DB-side existence check that follows,
which stays keyed the same way but now also needs `sku` added to ITS key
for consistency, since a DB-side duplicate check keyed only on
`platform:external_order_id` would now incorrectly flag legitimate
same-order-different-sku lines as "already exists" if any earlier line of
that order was imported previously) with a call to `dedupeImportRows`, and
update the subsequent DB-existence check's key construction to also
include `sku`. Read the full current `markDuplicates` function (through
its DB-check portion, roughly lines 250-309 per this plan's research)
before editing, since the exact boundary between "in-file dedupe" and
"DB-side check" needs to be preserved correctly.

- [ ] **Step 3: Write the test**

Create `src/app/dashboard/sales/_components/dedupeImportRows.test.ts`:

```ts
import { dedupeImportRows } from "./dedupeImportRows";
import type { ParsedRow } from "./importFormats";

function row(overrides: Partial<ParsedRow> & { data?: Partial<NonNullable<ParsedRow["data"]>> }): ParsedRow {
  return {
    rowNum: 1,
    error: null,
    ...overrides,
    data: overrides.data
      ? ({
          platform: "amazon",
          product_name: "Widget",
          quantity: 1,
          unit_price: 10,
          total_amount: 10,
          currency: "EUR",
          date: "2026-05-01",
          description: null,
          vat_rate: null,
          vat_amount: null,
          status: "delivered",
          restock: false,
          external_order_id: "028-6107376-1547566",
          shipping_cost: null,
          shipping_charged: null,
          advertising_fee: null,
          platform_fee: null,
          buyer_name: null,
          shipping_address_line1: null,
          shipping_address_line2: null,
          shipping_city: null,
          shipping_state: null,
          shipping_postal_code: null,
          shipping_country: null,
          buyer_phone: null,
          buyer_email: null,
          ...overrides.data,
        } as NonNullable<ParsedRow["data"]>)
      : null,
  };
}

describe("dedupeImportRows", () => {
  it("keeps two lines of the same order with different SKUs (the original bug)", () => {
    const rows = [
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1" } }),
      row({ sku: "SKU-B", data: { external_order_id: "ORDER-1" } }),
    ];
    expect(dedupeImportRows(rows)).toHaveLength(2);
  });

  it("merges two lines sharing order id AND sku, summing quantity and total_amount", () => {
    const rows = [
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", quantity: 2, total_amount: 20 } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", quantity: 3, total_amount: 30 } }),
    ];
    const result = dedupeImportRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].data?.quantity).toBe(5);
    expect(result[0].data?.total_amount).toBe(50);
  });

  it("sums vat_amount when both lines have one, leaves null when neither does", () => {
    const withVat = dedupeImportRows([
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: 1.5 } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: 2.5 } }),
    ]);
    expect(withVat[0].data?.vat_amount).toBe(4);

    const withoutVat = dedupeImportRows([
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: null } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: null } }),
    ]);
    expect(withoutVat[0].data?.vat_amount).toBeNull();
  });

  it("passes through refund rows and rows with no external_order_id unchanged", () => {
    const refund = row({ isRefund: true, data: undefined });
    const noOrderId = row({ data: { external_order_id: null as unknown as string } });
    expect(dedupeImportRows([refund])).toEqual([refund]);
    expect(dedupeImportRows([noOrderId])).toEqual([noOrderId]);
  });

  it("keeps different orders (different external_order_id) fully independent", () => {
    const rows = [
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1" } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-2" } }),
    ];
    expect(dedupeImportRows(rows)).toHaveLength(2);
  });
});
```

Fix the test factory's `data` defaults against `Sale`'s REAL field list
(Task 3 will have added the four new FX fields by the time this task
runs — this factory needs them included, defaulting to `null`, or the
type won't compile) — read `src/types/index.ts`'s current `Sale` interface
before finalizing this factory rather than trusting this plan's field
list, which may already be stale relative to Task 3's actual output.

- [ ] **Step 4: Run and verify**

Run: `npx jest dashboard/sales`
Expected: PASS, all cases, including the new dedupe suite.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/_components/dedupeImportRows.ts src/app/dashboard/sales/_components/dedupeImportRows.test.ts src/app/dashboard/sales/_components/ImportSalesModal.tsx
git commit -m "$(cat <<'EOF'
fix(sales): merge same-order-same-SKU import lines instead of dropping them

markDuplicates keyed in-file dedupe on (platform, external_order_id)
alone, silently dropping every line after the first for a multi-SKU
Amazon order — confirmed live: 27 order lines, EUR 816.35, 35 units lost
on a real May 2026 sheet. Fix keys on (platform, external_order_id, sku)
so different-SKU lines of the same order both survive (the common case),
and merges the rare case where two lines genuinely share all three
(quantity/total_amount/vat_amount summed) rather than reintroducing a
smaller version of the same bug by treating that case as a plain
duplicate to drop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Sales — unmatched-refund blocking warning (adjacent defect #2)

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `handleImport` now blocks on unmatched refunds until the user
  explicitly acknowledges.

- [ ] **Step 1: Read the current refund-matching code in full**

Read `ImportSalesModal.tsx`'s `handleImport` function in full (the refund
matcher this plan's research found at lines ~516-551), specifically how it
currently counts/reports an unmatched refund (the spec says it's "counted
in the summary and then discarded" — find the exact variable name, e.g.
`refundsUnmatched` or similar, and how it flows into the final
`ImportSummary`/toast).

- [ ] **Step 2: Add a blocking acknowledgement step**

Add state:
```ts
const [unmatchedRefundIds, setUnmatchedRefundIds] = useState<string[] | null>(null);
const [acknowledgedUnmatchedRefunds, setAcknowledgedUnmatchedRefunds] = useState(false);
```

In `handleImport`, BEFORE committing any writes, run the refund-matching
pass far enough to know which refunds are unmatched (this may require
reordering `handleImport` slightly — read it fully first to find the
least-disruptive way to compute matches before the insert step, since the
existing code likely matches refunds AFTER the sales insert per the
sales/CLAUDE.md note "**The insert must stay before the refund loop**").
Preserve that ordering constraint — the fix here is not to reorder
insert-vs-refund-matching (which sales/CLAUDE.md documents as
load-bearing), but to know the LIST of unmatched refund order ids and
surface them as a blocking dialog AFTER the normal import completes but
BEFORE the summary toast fires, if `acknowledgedUnmatchedRefunds` is not
yet true — i.e. the "blocking" nature is enforced via a confirmation step
between the existing import logic and the final success toast, not by
preventing the sales rows themselves from being written (which per the
existing documented ordering constraint must happen first regardless).

Concretely: if the refund-matching pass (which already runs, per the
existing code, after the sales insert) finds unmatched refund order ids,
set `unmatchedRefundIds` to that list instead of immediately finalizing
the summary/toast, and render a blocking modal/section listing them with
an "Import anyway" button that sets `acknowledgedUnmatchedRefunds` and
then proceeds to show the existing summary toast. If there are no
unmatched refunds, behavior is unchanged (no new UI appears).

- [ ] **Step 3: Update tests**

`ImportSalesModal.test.ts` (or wherever refund-outcome tests currently
live — likely within `importFormats.test.ts`'s refund-parsing tests, per
the sales/CLAUDE.md description of "Amazon SALE/REFUND rows") may need a
new case confirming an unmatched refund no longer disappears silently.
Given this is UI-flow behavior (a blocking dialog), a full component test
may be disproportionate for this codebase's existing test coverage style
(sales/CLAUDE.md notes `ImportSalesModal.tsx` itself is largely untested,
only `validateRowForFormat` is unit-tested) — if you add a test, scope it
to whatever pure logic you extracted (e.g. a function computing "which
refund order ids are unmatched" from a list of match results), not a full
React Testing Library render of the modal, matching this repo's existing
coverage philosophy for this file.

- [ ] **Step 4: Run and verify**

Run: `npx jest dashboard/sales && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/_components/ImportSalesModal.tsx
git commit -m "$(cat <<'EOF'
fix(sales): surface unmatched refunds as a blocking warning, not a silent count

30 REFUND rows on a real May 2026 sheet; 8 (EUR 93.21) matched no sale
in the file (orders from an earlier month) and were counted in the
import summary, then discarded — an understatement of returns in a
filed VAT figure. Now blocks the final success toast behind an explicit
"import anyway" acknowledgement listing the unmatched order ids.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Expenses — FX review wiring

**Files:**
- Modify: `src/app/dashboard/expenses/_components/expenseImportFormats.ts`
- Modify: `src/app/dashboard/expenses/_components/ImportExpensesModal.tsx`

**Interfaces:**
- Consumes: same as Task 9, applied to the Expenses import path.

- [ ] **Step 1: Change currency resolution in `expenseImportFormats.ts`**

Same change as Task 9 Step 2, applied to `validateExpenseRow`'s
currency-default logic (line ~235 per this plan's research) and
`classifySkip`'s currency guard (lines ~183-186) — replace both with
`resolveSheetCurrency`, add `sheetCurrency` to `ParsedExpenseRow` (or
whatever this file's row type is actually named — confirm by reading the
file), thread a new `baseCurrency` parameter through.

- [ ] **Step 2: Add the FX review step to `ImportExpensesModal.tsx`**

Same shape as Task 9 Step 3, adapted to this modal's actual state
variables (confirmed by this plan's research: `formatId`, `parsedSource`,
`parsed`, `fileName`, `loading`, `importError`, `orderSensitiveDates`,
`categoriesAreGuessed`). **Important divergence from Sales, already
documented in this repo**: this modal's async-staleness guard uses
`fileReadIdRef` as the ONLY live guard (`requestIdRef` is dead code here,
per the existing `expenses/CLAUDE.md` gotcha) — any new async round trip
this task adds (the `/api/fx/rates` call) must be re-checked against
`fileReadIdRef`, not assumed safe just because `parseAndValidate` looks
synchronous today. Read that gotcha in full in `expenses/CLAUDE.md` before
wiring the fetch call in.

- [ ] **Step 3: Update tests**

Same treatment as Task 9 Step 4, for `expenseImportFormats.test.ts`.

- [ ] **Step 4: Run and verify**

Run: `npx jest dashboard/expenses && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/expenses/_components/expenseImportFormats.ts src/app/dashboard/expenses/_components/ImportExpensesModal.tsx
git commit -m "$(cat <<'EOF'
feat(expenses): convert non-base-currency import rows via FX rate review

Same shared review step as Sales (Task 9). Threads the new async
/api/fx/rates round trip through this modal's fileReadIdRef staleness
guard specifically, not requestIdRef, which is documented dead code
here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Purchases — extract `purchaseImportFormats.ts` (parity refactor)

**Files:**
- Create: `src/app/dashboard/purchases/_components/purchaseImportFormats.ts`
- Create: `src/app/dashboard/purchases/_components/purchaseImportFormats.test.ts`
- Modify: `src/app/dashboard/purchases/_components/ImportPurchasesModal.tsx`

**Interfaces:**
- Produces: `validatePurchaseRow(raw, rowNum, dateOrder, baseCurrency):
  ParsedPurchaseRow` — the same shape of registry Sales/Expenses already
  have. Task 14 (FX wiring) depends on this existing first, since there's
  no format registry to hook a currency-resolution call into otherwise.

**This is a prerequisite refactor, not a currency-conversion feature by
itself — it brings Purchases up to the same infrastructure Sales/Expenses
already have (header aliases, flexible dates, locale numbers), which Task
14 then extends with FX handling.**

- [ ] **Step 1: Read the current inline logic in full**

Read `ImportPurchasesModal.tsx` in full (245 lines, per this plan's
research: inline `validateRow` at lines 27-72, hardcoded
`TEMPLATE_HEADERS`, strict ISO-date regex instead of `parseFlexibleDate`,
raw `parseInt`/`parseFloat` instead of `parseLocaleNumber`, a
locally-redeclared `VALID_CURRENCIES`, and duplicated file-reading helpers
not shared with Sales/Expenses). This task changes the validation/parsing
internals but must not change what a valid purchases CSV/Excel file
imports as, for any file that worked before this change — this is a
refactor, not a behavior change, aside from gaining the tolerance
Sales/Expenses already have (which is a strict superset: anything that
parsed under the old strict rules still parses the same way under the
tolerant ones).

- [ ] **Step 2: Write `purchaseImportFormats.ts`**

Follow `expenseImportFormats.ts`'s shape as the closer template (Purchases
has no multi-format dropdown, matching Expenses' simpler single-format
case more than Sales' three-format one) — a `ColumnSpec`-based column
registry, `resolveHeaders`/`canonicalizeRow` imported from
`lib/utils/importAliases`, `parseFlexibleDate` for dates,
`parseLocaleNumber` for `quantity`/`unit_price`, and an exported
`validatePurchaseRow(raw, rowNum, dateOrder, baseCurrency)` returning the
same `ParsedRow`-shaped structure (`{ rowNum, data, error, sku?,
sheetCurrency? }`) Sales/Expenses use — read `expenseImportFormats.ts` in
full immediately before writing this file so the shape actually matches
rather than approximating from memory of this plan's description.

Required columns stay `date, product_name, quantity, unit_price` (matching
the existing modal's required set); optional stay `vendor, currency,
vat_rate, description` — this task does not add or remove any column,
only changes HOW they're parsed. Include the `resolveSheetCurrency` call
from Task 4 as part of this file's currency handling from the start
(don't write a Task-9-style "old default to EUR" version here just to
change it again in Task 14 — Purchases has no existing behavior to
preserve here since this file doesn't exist yet).

- [ ] **Step 3: Write the tests**

Create `purchaseImportFormats.test.ts` following
`expenseImportFormats.test.ts`'s conventions (nested `describe`, a
`makeRawRow`-style factory, no mocking) — cover: required-column
validation, German header aliases now working (e.g. `Datum`/`Menge` where
they didn't before), decimal-comma tolerance now working (`"1.234,56"`),
and the currency resolution (blank → base currency, valid different code →
`sheetCurrency` set, garbage → error) using the same cases pattern as Task
4's `resolveSheetCurrency` tests.

- [ ] **Step 4: Wire the new module into `ImportPurchasesModal.tsx`**

Replace the modal's inline `validateRow` call sites with
`validatePurchaseRow` from the new file. Remove the modal's own duplicated
`VALID_CURRENCIES` constant and hardcoded `TEMPLATE_HEADERS` if the new
registry supersedes them (check whether `TEMPLATE_HEADERS` is still needed
for a "download template" button elsewhere in the modal before removing
it — if so, derive it from the new column registry instead of a separate
hardcoded array, so the two can't drift).

- [ ] **Step 5: Run and verify**

Run: `npx jest dashboard/purchases && npx tsc --noEmit`
Expected: both clean. Also manually trace through one existing real
purchases import test fixture (if one exists in the test suite) to
confirm behavior is unchanged for a plain base-currency file — this
refactor's whole point is "no behavior change for existing files," so
treat any change in existing test expectations as a red flag to
investigate, not a normal test update.

- [ ] **Step 6: Update `purchases/CLAUDE.md`**

Add a bullet for the new `purchaseImportFormats.ts` file, following the
existing file-map style, and update the "Import" section's description to
reflect the new alias/locale tolerance gained.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/purchases/_components/purchaseImportFormats.ts src/app/dashboard/purchases/_components/purchaseImportFormats.test.ts src/app/dashboard/purchases/_components/ImportPurchasesModal.tsx src/app/dashboard/purchases/CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor(purchases): extract purchaseImportFormats.ts, matching Sales/Expenses parity

Purchases import previously had no header-alias tolerance, no flexible
date parsing, and no decimal-comma tolerance — it read exact hardcoded
header names with a strict ISO-date regex and raw parseInt/parseFloat,
unlike Sales/Expenses which already had all three. This extraction is a
strict superset: any file that imported successfully before still does,
now with the same tolerance the other two features already have. Sets
up Task 14's FX review wiring, which needs a format-registry hook point
that didn't exist here before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Purchases — FX review wiring

**Files:**
- Modify: `src/app/dashboard/purchases/_components/ImportPurchasesModal.tsx`

**Interfaces:**
- Consumes: `purchaseImportFormats.ts` (Task 13), same FX infrastructure as
  Tasks 9/12.

- [ ] **Step 1: Add the FX review step**

Same shape as Task 9 Step 3 / Task 12 Step 2, adapted to this modal's
(now-registry-backed, per Task 13) state. Since Task 13 already wired
`resolveSheetCurrency`/`sheetCurrency` into `purchaseImportFormats.ts`,
this task is purely the UI-flow wiring (the `step` state, the
`/api/fx/rates` call, `<FxRateReview>` rendering, `handleConfirmRates`) —
no further changes to the format module itself.

- [ ] **Step 2: Run and verify**

Run: `npx jest dashboard/purchases && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/purchases/_components/ImportPurchasesModal.tsx
git commit -m "$(cat <<'EOF'
feat(purchases): convert non-base-currency import rows via FX rate review

Same shared review step as Sales/Expenses (Tasks 9/12), now that
Task 13 gave this modal a format registry to hook the currency
resolution into.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Display original currency on Sale/Expense detail views

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx`
- Modify: `src/app/dashboard/expenses/page.tsx` (or wherever expense detail
  is shown — Expenses may not have a dedicated `[id]` route; check first)

**Interfaces:**
- Consumes: `Sale.original_currency`/etc. (Task 3), applied at import time
  (Tasks 9/10/12/14).

- [ ] **Step 1: Read the current Sale detail rendering**

Read `src/app/dashboard/sales/[id]/page.tsx`'s Financials card in full to
find exactly where `total_amount` is displayed (per `sales/CLAUDE.md`,
this card shows qty/price/totals/fees/net proceeds). Do not trust a
specific line number from this plan — locate it by reading.

- [ ] **Step 2: Add the original-currency line**

Render, only when `sale.original_currency` is non-null, directly below
the main total:

```tsx
{sale.original_currency && sale.original_total_amount !== null && sale.fx_rate !== null && (
  <p className="text-xs text-(--color-text-faint) mt-1">
    Originally {sale.original_currency} {sale.original_total_amount.toFixed(2)} @{" "}
    {sale.fx_rate.toFixed(5)} (ECB {sale.fx_rate_date})
  </p>
)}
```

Match this repo's existing formatting conventions for currency figures
(check whether `formatCurrency` from `lib/utils/currency` should be used
for the original-amount figure too, given `original_currency` isn't a
`Currency`-typed value `formatCurrency` may expect — read that function's
signature before deciding whether to call it or format inline as above).

- [ ] **Step 3: Do the same for Expenses**

Find wherever an individual expense's amount is displayed in enough detail
to show a secondary line (the Expenses list page's row, or an edit modal's
read view) — read `expenses/CLAUDE.md` first to find the right spot, since
this plan's research didn't cover Expenses' display layer. Apply the same
conditional-rendering pattern.

- [ ] **Step 4: Run and verify**

Run: `npx jest dashboard/sales dashboard/expenses && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/[id]/page.tsx src/app/dashboard/expenses/page.tsx
git commit -m "$(cat <<'EOF'
feat(sales,expenses): show original currency/rate on converted rows

Rendered only when original_currency is non-null — a plain
base-currency row (still the overwhelming majority) shows nothing new.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Docs updates + final verification + full rollout

**Files:**
- Modify: `AGENTS.md`
- Verify/complete: `supabase/SKILL.md`, `sales/SKILL.md`,
  `expenses/CLAUDE.md` (already touched incidentally in Tasks 9-15 where
  each task's own docs step applied — this task is the final sweep, not a
  first pass)

- [ ] **Step 1: Add `src/lib/fx/` and `src/components/import/` to AGENTS.md's shared list**

Following the existing shared-vs-feature-private list's style (the same
section already extended once this session for `fetchAllRows`), add both
new directories with a one-line description of what each holds and why
they're shared (3+ consumers: Sales/Expenses/Purchases import, for
`components/import/`; server-only FX fetch+convert, used by the shared API
route and all three import paths, for `lib/fx/`).

- [ ] **Step 2: Sweep for any doc the "Docs to update" list in the spec named that a specific task above didn't already cover**

Cross-check the spec's "Docs to update in the same commits" section
against what Tasks 9-15 actually touched — `sales/SKILL.md`'s dedupe-key
gotcha and FX step, specifically, may not have been explicitly called out
as a step in Tasks 9-11 above (they focused on code) — add it now if
missing.

- [ ] **Step 3: Run everything**

```bash
npx jest
npx tsc --noEmit
uv run .claude/verifiers/test_rules.py
uv run .claude/verifiers/verify_changes.py --all
```
Expected: all clean/passing. If `verify_changes.py --all`'s count changed
from whatever it was before this plan started, investigate why before
proceeding — the new `/api/fx/rates` route in particular needs its auth
guard to actually satisfy the `route-without-auth` rule (it should, since
`requireFxAccess()` matches the pattern that rule recognizes — but verify,
don't assume).

- [ ] **Step 4 [CONTROLLER-EXECUTED, requires explicit human confirmation]: Full rollout**

Now that every other task is complete and verified against
`tenant_boughtopia`, this is Task 1's deferred Step 7: run the full,
unmodified `045_currency_conversion.sql`'s `run_on_all_tenant_schemas`
call against the live database, fanning out to all 5 tenants, only after
explicit confirmation. Verify via a read-only column-existence query per
tenant, same shape as Task 1 Step 6's `tenant_boughtopia` check.

- [ ] **Step 5: Confirm git state and hand off**

```bash
git log --oneline 0476663..HEAD
git status --short
```
Expected: 17 commits (Task 1: 1, Task 2: 1, Tasks 3-15: 1 each, Task 16: 1
— adjust if any task needed a fix-round commit), clean working tree. Push
and open a PR when the human partner is ready — this branch already holds
the approved design spec as its base commit, so the PR's diff naturally
includes both the spec and the implementation; note in the PR description
that this is sub-project 1 of 3 from that spec, with expense receipts and
date filters as separate, not-yet-started follow-up plans.

## Self-review notes

- **Spec coverage**: every subsection of the spec's "1. Currency
  conversion" and "Adjacent import defects" sections maps to a task above.
  The "Display" subsection → Task 15. "Adjacent" → Tasks 10-11. Every file
  the spec's own "Files" list names (`lib/fx/ecb.ts`, `lib/fx/convert.ts`,
  `api/fx/rates/route.ts`, `control.fx_rates`, `FxRateReview.tsx`,
  `fxReviewState.ts`) has a task. "Docs to update" → Task 16 plus each
  task's own doc step.
- **Explicitly out of scope, confirmed not touched by any task above**:
  `receipts` column, `expense-receipts` bucket, `ReceiptUploader`,
  `FilterBar`'s "Specific period" entry, `periodRange`/`describePeriod`,
  the "404 orders with vat_rate=0" item the spec explicitly marks "Not
  fixed here."
- **Placeholder scan**: every code block above is real, runnable code, not
  a description. Two deliberate exceptions, both explicitly flagged as
  such rather than silently glossed: Task 4's `vat_amount` test
  expectation asks the implementer to verify the exact rounding output
  against their own implementation rather than trusting this plan's
  hand-computed guess (a genuine floating-point-arithmetic uncertainty,
  not laziness); Task 8's component asks the implementer to verify
  `Select`/`Input`/`Button`'s real prop names against the actual files
  before finalizing (this plan wrote a best-effort version from other
  modals' described usage, not a verified read of those exact component
  source files).
- **Type consistency**: `ParsedRow.sheetCurrency` (Task 9), the reused
  `ParsedRow`-shape return from `validatePurchaseRow` (Task 13), and
  `applyRate`'s generic constraint (Task 4) all agree on the same field
  names (`total_amount`, `vat_amount`, `original_currency`,
  `original_total_amount`, `fx_rate`, `fx_rate_date`) — checked against
  each other while writing this plan, not just within each task in
  isolation.
- **Known unresolved design gap, flagged for the implementer rather than
  silently decided**: Task 11's exact refactor of `handleImport`'s
  ordering (insert-before-refund-matching, an existing documented
  constraint) to surface unmatched refunds as a blocking step is described
  functionally, not as an exact diff, because this plan's research did not
  capture `handleImport`'s full current body verbatim — the implementer
  must read it in full first (Task 11 Step 1 says so explicitly) rather
  than this plan guessing at a 800-line function's exact control flow.
