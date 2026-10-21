# eBay Fees & Account Charges (Finances API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull eBay's real per-order fees and the account charges that aren't tied to an order (insertion fees, subscription, promoted listings, labels) from the Finances API into Sales fees and Expenses.

**Architecture:** One server-only fetch module (`ebay/finances.ts`) plus one pure mapping module (`ebay/financesMap.ts`) feed two entry points. The first is the existing Review Orders GET, which pre-fills fees. The second is a new `POST /api/integrations/ebay/charges/sync` route that upserts Expenses (deduped on `external_ref`) and fills empty fees on already-imported sales. A new `platform_fees` expense category is TS/UI-only (live `expenses.category` is unconstrained `text`).

**Tech Stack:** Next.js App Router route handlers, Supabase (tenant client + RLS), Jest, eBay Sell Finances API v1.

Spec: `docs/superpowers/specs/2026-10-21-ebay-finances-fees-design.md`.

## Global Constraints

- Branch: `feat/ebay-finances-fees` (already created from `main`; the spec commit is on it).
- Tenant DDL only through `public.run_on_all_tenant_schemas($$ … {{schema}} … $$)`, and the same change is mirrored into `provision_tenant_schema()` in `supabase/migrations/005_tenant_provisioning.sql` in the same commit.
- `src/lib/integrations/**` is server-only. Never import it from a `"use client"` file. Client-safe error copy goes in `src/lib/utils/integrationErrors.ts`.
- Never return a raw Postgres/eBay error body to the client.
- Finances base URL: `https://apiz.ebay.com` (sandbox `https://apiz.sandbox.ebay.com` when `EBAY_SANDBOX === "true"`).
- New scope string: `https://api.ebay.com/oauth/api_scope/sell.finances`.
- `external_ref` format: `ebay:<transactionId>`. Fee map key format: `<orderId>:<lineItemId>` (identical to `sales.external_order_id`).
- Lookback: 90 days (same as `REVIEW_LOOKBACK_MS` in the review route).
- A user-entered `platform_fee`/`advertising_fee` is never overwritten. Only `NULL` gets filled.
- Supported currencies: `EUR`, `USD`, `GBP`. Any other currency is skipped and counted.
- Do not run `tsc`/`lint` by hand; the pre-commit hook runs them. Run focused `npx jest <path>`.
- Every mutation in the UI toasts on success and on failure. A busy button shows a busy verb and is disabled.

**Deviation from spec (deliberate):** the spec names `fetchSaleFeesForOrders(token, orderIds)`. The Finances API's `orderId` filter takes one id per call, so the review prefill instead fetches all `SALE` transactions in the same 90-day window, in one paginated call per connection. Same result, far fewer requests.

---

### Task 1: Migration 058 — `expenses.external_ref` + `connection_id`

**Files:**
- Create: `supabase/migrations/058_expenses_external_ref.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (just after line ~912, the 056 `sales.connection_id` block)
- Modify: `supabase/CLAUDE.md` (add 058 entry), `supabase/SKILL.md` (file-map row, status "Not applied")

**Interfaces:**
- Produces: columns `expenses.external_ref text`, `expenses.connection_id uuid` (FK `platform_connections`, `ON DELETE SET NULL`), unique index `idx_expenses_external_ref`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/058_expenses_external_ref.sql
-- ============================================================
-- 058 — expenses.external_ref + expenses.connection_id
-- Design: docs/superpowers/specs/2026-10-21-ebay-finances-fees-design.md
--
-- external_ref: dedup key for expenses imported from a platform API
-- ('ebay:<transactionId>'). FULL (non-partial) unique index on purpose —
-- Supabase .upsert({ onConflict }) cannot target a partial index (033).
-- NULLs never conflict, so manual expenses are unaffected.
-- connection_id: which platform_connections account a charge came from
-- (same shape as sales.connection_id, 056).
-- No category change: expenses.category is plain text with no CHECK on
-- every live tenant (checked 2026-10-21); 'platform_fees' is TS/UI only.
-- Mirrored into provision_tenant_schema() (005).
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS external_ref text,
    ADD COLUMN IF NOT EXISTS connection_id uuid
      REFERENCES {{schema}}.platform_connections(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external_ref
    ON {{schema}}.expenses (external_ref);
$$);
```

- [ ] **Step 2: Mirror into 005**

Directly after the line `EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_connection_id ON %1$I.sales (connection_id)', schema_name);` add:

```sql
  -- Platform-imported expenses (058): dedup key + source account.
  EXECUTE format('ALTER TABLE %1$I.expenses ADD COLUMN IF NOT EXISTS external_ref text', schema_name);
  EXECUTE format('ALTER TABLE %1$I.expenses ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES %1$I.platform_connections(id) ON DELETE SET NULL', schema_name);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external_ref ON %1$I.expenses (external_ref)', schema_name);
```

- [ ] **Step 3: Docs.** Add a `migrations/058_expenses_external_ref.sql` bullet to `supabase/CLAUDE.md` (after the 057 entry) summarising Step 1's header, and a row in `supabase/SKILL.md`'s file map with apply-status **Not applied**.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/058_expenses_external_ref.sql supabase/migrations/005_tenant_provisioning.sql supabase/CLAUDE.md supabase/SKILL.md
git commit -m "feat(db): 058 expenses.external_ref + connection_id for platform-imported charges"
```

(The live apply is a separate step for the user. It is not part of this task.)

---

### Task 2: `platform_fees` category + shared category list

The category list is copy-pasted in four files and labelled with `charAt(0).toUpperCase()`, which would render `Platform_fees`. Consolidate it into one place.

**Files:**
- Create: `src/lib/utils/expenseCategories.ts`, `src/lib/utils/expenseCategories.test.ts`
- Modify: `src/types/index.ts:37-45` (`ExpenseCategory`), `src/types/index.ts` `Expense` interface (add two fields)
- Modify: `src/app/dashboard/expenses/page.tsx:39-42`, `_components/AddExpenseModal.tsx:17-20` and its option label at `:235-238`, `_components/EditExpenseModal.tsx:17-20` and its option label, `_components/expenseImportFormats.ts:37-39`, plus any other `c.charAt(0).toUpperCase() + c.slice(1)` that labels a category in `expenses/page.tsx` (grep `charAt(0)` there)

**Interfaces:**
- Produces: `EXPENSE_CATEGORIES: readonly ExpenseCategory[]`, `expenseCategoryLabel(c: ExpenseCategory): string`; `Expense.external_ref: string | null`; `Expense.connection_id: string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/utils/expenseCategories.test.ts
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "./expenseCategories";

describe("expense categories", () => {
  it("includes platform_fees exactly once, before other", () => {
    expect(EXPENSE_CATEGORIES.filter((c) => c === "platform_fees")).toHaveLength(1);
    expect(EXPENSE_CATEGORIES.at(-1)).toBe("other");
  });

  it("labels every category without underscores", () => {
    for (const c of EXPENSE_CATEGORIES) expect(expenseCategoryLabel(c)).not.toContain("_");
    expect(expenseCategoryLabel("platform_fees")).toBe("Platform fees");
    expect(expenseCategoryLabel("shipping")).toBe("Shipping");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx jest src/lib/utils/expenseCategories`
Expected: FAIL, "Cannot find module './expenseCategories'".

- [ ] **Step 3: Implement**

In `src/types/index.ts`, change `ExpenseCategory` to add `| "platform_fees"` before `| "other"`. In `Expense` (after `receipts`/the FX fields), add:

```ts
  // Platform-imported charges (058): 'ebay:<transactionId>', and the account it came from.
  external_ref: string | null;
  connection_id: string | null;
```

```ts
// src/lib/utils/expenseCategories.ts
import type { ExpenseCategory } from "@/types";

/** Display order for every expense category picker/filter. `other` stays last. */
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "platform_fees", "other",
];

const LABELS: Partial<Record<ExpenseCategory, string>> = { platform_fees: "Platform fees" };

export function expenseCategoryLabel(c: ExpenseCategory): string {
  return LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}
```

Replace the four local `CATEGORIES`/`VALID_CATEGORIES` arrays with `EXPENSE_CATEGORIES` (keep each file's local name as an alias if that keeps the diff small: `const CATEGORIES = EXPENSE_CATEGORIES;`). Replace each category label expression with `expenseCategoryLabel(c)`. If TypeScript then complains about places that build `Expense` objects (tests/fixtures, `addExpense` payloads), add `external_ref: null, connection_id: null` there.

- [ ] **Step 4: Run tests**

Run: `npx jest src/lib/utils/expenseCategories dashboard/expenses`
Expected: PASS.

- [ ] **Step 5: Docs + commit.** In `src/app/dashboard/expenses/SKILL.md`, add a gotcha: categories live in `lib/utils/expenseCategories.ts`, `platform_fees` is TS-only (no DB CHECK), and rows with `external_ref` set were imported by eBay charge sync. Update `expenses/CLAUDE.md`'s shared deps.

```bash
git add src/lib/utils/expenseCategories.ts src/lib/utils/expenseCategories.test.ts src/types/index.ts src/app/dashboard/expenses
git commit -m "feat(expenses): platform_fees category, shared category list and labels"
```

---

### Task 3: Pure Finances mapping — `financesMap.ts`

**Files:**
- Create: `src/lib/integrations/ebay/financesMap.ts`, `src/lib/integrations/ebay/financesMap.test.ts`

**Interfaces:**
- Consumes: `ExpenseCategory`, `Currency` from `@/types`.
- Produces (exact):

```ts
export interface EbayFinanceMoney { value: string; currency: string }
export interface EbayMarketplaceFee { feeType?: string; amount?: EbayFinanceMoney; feeMemo?: string }
export interface EbayFinanceTransaction {
  transactionId: string;
  transactionType: string;          // SALE | NON_SALE_CHARGE | SHIPPING_LABEL | CREDIT | …
  transactionDate: string;          // ISO timestamp
  bookingEntry?: "CREDIT" | "DEBIT";
  amount?: EbayFinanceMoney;
  orderId?: string;
  feeType?: string;                 // set on NON_SALE_CHARGE
  transactionMemo?: string;
  orderLineItems?: { lineItemId: string; marketplaceFees?: EbayMarketplaceFee[] }[];
  references?: { referenceId: string; referenceType: string }[];
}
export interface LineItemFees { platformFee: number | null; advertisingFee: number | null }
export function isAdFeeType(feeType: string | undefined): boolean;
export function feesByLineItem(txns: EbayFinanceTransaction[]): Map<string, LineItemFees>;
export function categoryForCharge(txn: EbayFinanceTransaction): ExpenseCategory;
export interface ChargeExpenseRow {
  title: string; amount: number; currency: Currency; category: ExpenseCategory;
  vendor: string; date: string; description: string | null; created_by: string;
  external_ref: string; connection_id: string | null;
}
export function chargeToExpenseRow(
  txn: EbayFinanceTransaction,
  ctx: { createdBy: string; connectionId: string | null; accountLabel: string }
): ChargeExpenseRow | null;
export const CHARGE_TRANSACTION_TYPES: readonly string[]; // ["NON_SALE_CHARGE","SHIPPING_LABEL","CREDIT"]
export function fillEmptyFees(
  existing: { platform_fee: number | null; advertising_fee: number | null },
  fees: LineItemFees
): { platform_fee?: number; advertising_fee?: number } | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/integrations/ebay/financesMap.test.ts
import {
  categoryForCharge, chargeToExpenseRow, feesByLineItem, fillEmptyFees, isAdFeeType,
  type EbayFinanceTransaction,
} from "./financesMap";

const money = (value: string, currency = "EUR") => ({ value, currency });
const ctx = { createdBy: "user-1", connectionId: "conn-1", accountLabel: "Main shop" };

function sale(lines: EbayFinanceTransaction["orderLineItems"]): EbayFinanceTransaction {
  return { transactionId: "t-sale", transactionType: "SALE", transactionDate: "2026-10-01T10:00:00.000Z", orderId: "12-345", orderLineItems: lines };
}

describe("isAdFeeType", () => {
  it.each(["AD_FEE", "PREMIUM_AD_FEES", "PROMOTED_LISTING_FEE"])("%s is advertising", (t) => {
    expect(isAdFeeType(t)).toBe(true);
  });
  it.each(["FINAL_VALUE_FEE", "INSERTION_FEE", "INTERNATIONAL_FEE", undefined])("%s is not", (t) => {
    expect(isAdFeeType(t)).toBe(false);
  });
});

describe("feesByLineItem", () => {
  it("keys by orderId:lineItemId and buckets ad vs platform fees, summing and rounding", () => {
    const map = feesByLineItem([
      sale([
        {
          lineItemId: "L1",
          marketplaceFees: [
            { feeType: "FINAL_VALUE_FEE", amount: money("1.11") },
            { feeType: "FINAL_VALUE_FEE_FIXED_PER_ORDER", amount: money("0.35") },
            { feeType: "AD_FEE", amount: money("0.80") },
          ],
        },
        { lineItemId: "L2", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: money("2.00") }] },
      ]),
    ]);
    expect(map.get("12-345:L1")).toEqual({ platformFee: 1.46, advertisingFee: 0.8 });
    expect(map.get("12-345:L2")).toEqual({ platformFee: 2, advertisingFee: null });
  });

  it("ignores non-SALE transactions and SALEs without an orderId", () => {
    const charge: EbayFinanceTransaction = { transactionId: "t1", transactionType: "NON_SALE_CHARGE", transactionDate: "2026-10-01T00:00:00Z" };
    const noOrder = { ...sale([{ lineItemId: "L1", marketplaceFees: [] }]), orderId: undefined };
    expect(feesByLineItem([charge, noOrder]).size).toBe(0);
  });
});

describe("categoryForCharge", () => {
  it("maps ad charges to advertising, labels to shipping, the rest to platform_fees", () => {
    const base = { transactionId: "t", transactionDate: "2026-10-01T00:00:00Z" };
    expect(categoryForCharge({ ...base, transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE" })).toBe("advertising");
    expect(categoryForCharge({ ...base, transactionType: "SHIPPING_LABEL" })).toBe("shipping");
    expect(categoryForCharge({ ...base, transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE" })).toBe("platform_fees");
    expect(categoryForCharge({ ...base, transactionType: "NON_SALE_CHARGE", feeType: "SUBSCRIPTION_FEE" })).toBe("platform_fees");
    expect(categoryForCharge({ ...base, transactionType: "CREDIT" })).toBe("platform_fees");
  });
});

describe("chargeToExpenseRow", () => {
  const charge: EbayFinanceTransaction = {
    transactionId: "abc123", transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE",
    transactionDate: "2026-10-03T08:15:00.000Z", bookingEntry: "DEBIT", amount: money("0.35"),
    transactionMemo: "Listing 1234",
  };

  it("builds a positive platform_fees expense with an ebay: external_ref", () => {
    expect(chargeToExpenseRow(charge, ctx)).toEqual({
      title: "eBay insertion fee", amount: 0.35, currency: "EUR", category: "platform_fees",
      vendor: "eBay", date: "2026-10-03", description: "Main shop — Listing 1234",
      created_by: "user-1", external_ref: "ebay:abc123", connection_id: "conn-1",
    });
  });

  it("stores a CREDIT booking as a negative amount", () => {
    const row = chargeToExpenseRow({ ...charge, bookingEntry: "CREDIT", amount: money("0.35") }, ctx);
    expect(row?.amount).toBe(-0.35);
  });

  it("titles labels and bare credits sensibly", () => {
    expect(chargeToExpenseRow({ ...charge, transactionType: "SHIPPING_LABEL", feeType: undefined }, ctx)?.title).toBe("eBay shipping label");
    expect(chargeToExpenseRow({ ...charge, transactionType: "CREDIT", feeType: undefined }, ctx)?.title).toBe("eBay credit");
  });

  it("returns null for an unsupported currency or a missing amount", () => {
    expect(chargeToExpenseRow({ ...charge, amount: money("1.00", "PLN") }, ctx)).toBeNull();
    expect(chargeToExpenseRow({ ...charge, amount: undefined }, ctx)).toBeNull();
  });
});

describe("fillEmptyFees", () => {
  it("fills only NULL fields and never overwrites a user value", () => {
    expect(fillEmptyFees({ platform_fee: null, advertising_fee: 1 }, { platformFee: 2, advertisingFee: 3 }))
      .toEqual({ platform_fee: 2 });
    expect(fillEmptyFees({ platform_fee: 0, advertising_fee: 5 }, { platformFee: 2, advertisingFee: 3 })).toBeNull();
  });
  it("returns null when eBay has nothing to add", () => {
    expect(fillEmptyFees({ platform_fee: null, advertising_fee: null }, { platformFee: null, advertisingFee: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx jest src/lib/integrations/ebay/financesMap`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/integrations/ebay/financesMap.ts
import type { Currency, ExpenseCategory } from "@/types";

// (paste the interfaces from the Interfaces block above)

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];
export const CHARGE_TRANSACTION_TYPES = ["NON_SALE_CHARGE", "SHIPPING_LABEL", "CREDIT"] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** eBay names ad fees several ways (AD_FEE, PREMIUM_AD_FEES, PROMOTED_LISTING_FEE). */
export function isAdFeeType(feeType: string | undefined): boolean {
  return !!feeType && (/(^|_)AD_FEES?$/.test(feeType) || feeType.startsWith("PROMOTED"));
}

/** Per-line-item fees from SALE transactions, keyed like sales.external_order_id. */
export function feesByLineItem(txns: EbayFinanceTransaction[]): Map<string, LineItemFees> {
  const out = new Map<string, LineItemFees>();
  for (const txn of txns) {
    if (txn.transactionType !== "SALE" || !txn.orderId) continue;
    for (const line of txn.orderLineItems ?? []) {
      let platform = 0, ad = 0, hasPlatform = false, hasAd = false;
      for (const fee of line.marketplaceFees ?? []) {
        const v = Math.abs(Number(fee.amount?.value ?? 0));
        if (!Number.isFinite(v)) continue;
        if (isAdFeeType(fee.feeType)) { ad += v; hasAd = true; } else { platform += v; hasPlatform = true; }
      }
      out.set(`${txn.orderId}:${line.lineItemId}`, {
        platformFee: hasPlatform ? round2(platform) : null,
        advertisingFee: hasAd ? round2(ad) : null,
      });
    }
  }
  return out;
}

export function categoryForCharge(txn: EbayFinanceTransaction): ExpenseCategory {
  if (txn.transactionType === "SHIPPING_LABEL") return "shipping";
  if (isAdFeeType(txn.feeType)) return "advertising";
  return "platform_fees";
}

function chargeTitle(txn: EbayFinanceTransaction): string {
  if (txn.feeType) return `eBay ${txn.feeType.toLowerCase().replace(/_/g, " ")}`;
  if (txn.transactionType === "SHIPPING_LABEL") return "eBay shipping label";
  if (txn.transactionType === "CREDIT") return "eBay credit";
  return `eBay ${txn.transactionType.toLowerCase().replace(/_/g, " ")}`;
}

/** One account charge → an expenses insert row; null when it can't be stored. */
export function chargeToExpenseRow(
  txn: EbayFinanceTransaction,
  ctx: { createdBy: string; connectionId: string | null; accountLabel: string }
): ChargeExpenseRow | null {
  const currency = txn.amount?.currency as Currency | undefined;
  const value = Math.abs(Number(txn.amount?.value));
  if (!currency || !CURRENCIES.includes(currency) || !Number.isFinite(value)) return null;
  const sign = txn.bookingEntry === "CREDIT" ? -1 : 1;
  const memo = txn.transactionMemo ?? txn.references?.[0]?.referenceId ?? null;
  return {
    title: chargeTitle(txn),
    amount: round2(sign * value),
    currency,
    category: categoryForCharge(txn),
    // "eBay" keeps get_platform_running_balance's strpos(lower(...),'ebay') match working.
    vendor: "eBay",
    date: txn.transactionDate.slice(0, 10),
    description: memo ? `${ctx.accountLabel} — ${memo}` : ctx.accountLabel,
    created_by: ctx.createdBy,
    external_ref: `ebay:${txn.transactionId}`,
    connection_id: ctx.connectionId,
  };
}

/** The patch that fills a sale's still-empty fees from eBay; null if nothing to change. */
export function fillEmptyFees(
  existing: { platform_fee: number | null; advertising_fee: number | null },
  fees: LineItemFees
): { platform_fee?: number; advertising_fee?: number } | null {
  const patch: { platform_fee?: number; advertising_fee?: number } = {};
  if (existing.platform_fee === null && fees.platformFee !== null) patch.platform_fee = fees.platformFee;
  if (existing.advertising_fee === null && fees.advertisingFee !== null) patch.advertising_fee = fees.advertisingFee;
  return Object.keys(patch).length ? patch : null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/lib/integrations/ebay/financesMap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ebay/financesMap.ts src/lib/integrations/ebay/financesMap.test.ts
git commit -m "feat(integrations): pure eBay Finances mapping (fees per line item, charges to expenses)"
```

---

### Task 4: Finances fetch + `sell.finances` scope

**Files:**
- Create: `src/lib/integrations/ebay/finances.ts`, `src/lib/integrations/ebay/finances.test.ts`
- Modify: `src/lib/integrations/ebay.ts:27-32` (`EBAY_SCOPE`)
- Modify: `src/lib/utils/integrationErrors.ts` (new code)

**Interfaces:**
- Consumes: `EbayFinanceTransaction` from `./financesMap`.
- Produces:

```ts
export class FinancesScopeError extends Error {}
export async function fetchFinanceTransactions(
  accessToken: string,
  opts: { from: string; to: string; types: readonly string[]; marketplaceId?: string | null }
): Promise<EbayFinanceTransaction[]>;
```
and the error code `INTEGRATION_FINANCES_SCOPE` in `INTEGRATION_ERRORS`.

- [ ] **Step 1: Write the failing tests** (same `global.fetch` mocking style as `src/lib/integrations/ebay.test.ts`)

```ts
// src/lib/integrations/ebay/finances.test.ts
import { fetchFinanceTransactions, FinancesScopeError } from "./finances";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const page = (ids: string[], total: number, offset: number) => ({
  ok: true, status: 200,
  json: () => Promise.resolve({
    total, offset, limit: 1000,
    transactions: ids.map((id) => ({ transactionId: id, transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z" })),
  }),
});

const opts = { from: "2026-07-23T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z", types: ["SALE", "NON_SALE_CHARGE"], marketplaceId: "EBAY_DE" };

describe("fetchFinanceTransactions", () => {
  it("calls the apiz Finances endpoint with date+type filters and the marketplace header", async () => {
    const fetchMock = jest.fn().mockResolvedValue(page(["a"], 1, 0));
    global.fetch = fetchMock as unknown as typeof fetch;

    const txns = await fetchFinanceTransactions("tok", opts);

    expect(txns.map((t) => t.transactionId)).toEqual(["a"]);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://apiz.ebay.com/sell/finances/v1/transaction");
    expect(u.searchParams.get("filter")).toBe(
      "transactionDate:[2026-07-23T00:00:00.000Z..2026-10-21T00:00:00.000Z],transactionType:{SALE|NON_SALE_CHARGE}"
    );
    expect(u.searchParams.get("limit")).toBe("1000");
    expect(u.searchParams.get("offset")).toBe("0");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_DE");
  });

  it("follows offsets until total is reached", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(page(Array.from({ length: 1000 }, (_, i) => `a${i}`), 1500, 0))
      .mockResolvedValueOnce(page(Array.from({ length: 500 }, (_, i) => `b${i}`), 1500, 1000));
    global.fetch = fetchMock as unknown as typeof fetch;

    const txns = await fetchFinanceTransactions("tok", opts);

    expect(txns).toHaveLength(1500);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("offset")).toBe("1000");
  });

  it("throws FinancesScopeError on 403", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve("insufficient scope") }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", opts)).rejects.toBeInstanceOf(FinancesScopeError);
  });

  it("throws a plain Error on other failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", opts)).rejects.not.toBeInstanceOf(FinancesScopeError);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx jest src/lib/integrations/ebay/finances.test`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/integrations/ebay/finances.ts
import type { EbayFinanceTransaction } from "./financesMap";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
// The Finances API is served from apiz.*, like the Identity API.
const FINANCES_URL = `${SANDBOX ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com"}/sell/finances/v1/transaction`;
const PAGE_LIMIT = 1000; // eBay's max page size for getTransactions
const MAX_PAGES = 50;    // 50k transactions per 90-day window — a hard stop, not an expected size

/** 403 from Finances = the connection pre-dates the sell.finances scope; reconnect fixes it. */
export class FinancesScopeError extends Error {}

export async function fetchFinanceTransactions(
  accessToken: string,
  opts: { from: string; to: string; types: readonly string[]; marketplaceId?: string | null }
): Promise<EbayFinanceTransaction[]> {
  const filter = `transactionDate:[${opts.from}..${opts.to}],transactionType:{${opts.types.join("|")}}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  if (opts.marketplaceId) headers["X-EBAY-C-MARKETPLACE-ID"] = opts.marketplaceId;

  const out: EbayFinanceTransaction[] = [];
  for (let pageNo = 0, offset = 0; pageNo < MAX_PAGES; pageNo++) {
    const url = new URL(FINANCES_URL);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), { headers });
    if (res.status === 403) throw new FinancesScopeError("eBay Finances API: insufficient scope");
    if (!res.ok) throw new Error(`eBay finances request failed: ${res.status} ${await res.text()}`);

    const json = (await res.json()) as { transactions?: EbayFinanceTransaction[]; total?: number };
    const batch = json.transactions ?? [];
    out.push(...batch);
    offset += batch.length;
    if (batch.length === 0 || offset >= (json.total ?? 0)) break;
  }
  return out;
}
```

Change `EBAY_SCOPE` in `src/lib/integrations/ebay.ts` by appending `" https://api.ebay.com/oauth/api_scope/sell.finances"` before the `commerce.identity.readonly` line, and extend the comment above it: "sell.finances (2026-10-21) backs fee/charge import; older connections 403 on Finances until reconnected".

In `src/lib/utils/integrationErrors.ts` add to `INTEGRATION_ERRORS`:

```ts
  INTEGRATION_FINANCES_SCOPE:
    "Reconnect this eBay account (Reconnect on its card) to import eBay fees and charges.",
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/lib/integrations/ebay/finances src/lib/integrations/ebay.test`
Expected: PASS. If an `ebay.test.ts` assertion pins the exact scope string, update it to include `sell.finances`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ebay/finances.ts src/lib/integrations/ebay/finances.test.ts src/lib/integrations/ebay.ts src/lib/integrations/ebay.test.ts src/lib/utils/integrationErrors.ts
git commit -m "feat(integrations): eBay Finances transaction fetch + sell.finances scope"
```

---

### Task 5: `POST /api/integrations/ebay/charges/sync`

**Files:**
- Create: `src/app/api/integrations/ebay/charges/sync/route.ts`
- Create: `src/lib/integrations/ebay/chargeSync.ts`, `src/lib/integrations/ebay/chargeSync.test.ts` (the testable core, with the Supabase client injected)

**Interfaces:**
- Consumes: `fetchFinanceTransactions`, `FinancesScopeError` (Task 4); `feesByLineItem`, `chargeToExpenseRow`, `fillEmptyFees`, `CHARGE_TRANSACTION_TYPES` (Task 3); `requireIntegrationAdmin`, `getTenantEntitlements`, `hasPlatformIntegrations`, `requireActiveConnection`, `IntegrationAccountError`, `ensureValidAccessToken`, `getAdapter`, `accountLabel` (existing).
- Produces:

```ts
// chargeSync.ts
export interface ChargeSyncResult { chargesImported: number; chargesAlreadyImported: number; skippedCurrency: number; ordersFeesFilled: number }
export class ChargeSyncPermissionError extends Error {}
export async function applyFinanceTransactions(
  client: IntegrationsClient,
  txns: EbayFinanceTransaction[],
  ctx: { createdBy: string; connectionId: string; accountLabel: string }
): Promise<ChargeSyncResult>;
```
Route response: `200 ChargeSyncResult`; errors as `{ error: <INTEGRATION_* code or message> }`.

- [ ] **Step 1: Write the failing test** for `applyFinanceTransactions`, using a hand-rolled fake client that records calls

```ts
// src/lib/integrations/ebay/chargeSync.test.ts
import { applyFinanceTransactions, ChargeSyncPermissionError } from "./chargeSync";
import type { EbayFinanceTransaction } from "./financesMap";

type Call = { table: string; op: string; args: unknown[] };

function fakeClient(opts: {
  upsertReturns?: { data: { id: string }[] | null; error: { code?: string; message: string } | null };
  sales?: { id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null }[];
}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const q = {
        upsert: (...args: unknown[]) => { calls.push({ table, op: "upsert", args }); return { select: () => Promise.resolve(opts.upsertReturns ?? { data: [], error: null }) }; },
        select: () => ({
          eq: () => ({ in: (_c: string, ids: string[]) => Promise.resolve({ data: (opts.sales ?? []).filter((s) => ids.includes(s.external_order_id)), error: null }) }),
        }),
        update: (patch: unknown) => ({ eq: (_c: string, id: string) => { calls.push({ table, op: "update", args: [patch, id] }); return Promise.resolve({ error: null }); } }),
      };
      return q;
    },
  };
  return { client: client as never, calls };
}

const ctx = { createdBy: "u1", connectionId: "c1", accountLabel: "Shop" };
const charge = (id: string, currency = "EUR"): EbayFinanceTransaction => ({
  transactionId: id, transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE",
  transactionDate: "2026-10-02T00:00:00Z", bookingEntry: "DEBIT", amount: { value: "0.35", currency },
});
const saleTxn: EbayFinanceTransaction = {
  transactionId: "s1", transactionType: "SALE", transactionDate: "2026-10-02T00:00:00Z", orderId: "O1",
  orderLineItems: [{ lineItemId: "L1", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: { value: "1.20", currency: "EUR" } }] }],
};

describe("applyFinanceTransactions", () => {
  it("upserts charges with ignoreDuplicates on external_ref and counts new vs existing and skipped currency", async () => {
    const { client, calls } = fakeClient({ upsertReturns: { data: [{ id: "e1" }], error: null } });
    const r = await applyFinanceTransactions(client, [charge("a"), charge("b"), charge("c", "PLN")], ctx);
    const up = calls.find((c) => c.op === "upsert")!;
    expect((up.args[0] as unknown[]).length).toBe(2);
    expect(up.args[1]).toEqual({ onConflict: "external_ref", ignoreDuplicates: true });
    expect(r).toMatchObject({ chargesImported: 1, chargesAlreadyImported: 1, skippedCurrency: 1 });
  });

  it("fills only empty fees on matching eBay sales", async () => {
    const { client, calls } = fakeClient({
      sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }],
    });
    const r = await applyFinanceTransactions(client, [saleTxn], ctx);
    expect(calls.filter((c) => c.op === "update")).toEqual([{ table: "sales", op: "update", args: [{ platform_fee: 1.2 }, "sale-1"] }]);
    expect(r.ordersFeesFilled).toBe(1);
  });

  it("leaves a sale with a user-entered fee untouched", async () => {
    const { client, calls } = fakeClient({
      sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: 0.5, advertising_fee: null }],
    });
    const r = await applyFinanceTransactions(client, [saleTxn], ctx);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(r.ordersFeesFilled).toBe(0);
  });

  it("throws ChargeSyncPermissionError on an RLS 42501", async () => {
    const { client } = fakeClient({ upsertReturns: { data: null, error: { code: "42501", message: "denied" } } });
    await expect(applyFinanceTransactions(client, [charge("a")], ctx)).rejects.toBeInstanceOf(ChargeSyncPermissionError);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx jest src/lib/integrations/ebay/chargeSync`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `chargeSync.ts`**

```ts
// src/lib/integrations/ebay/chargeSync.ts
import type { IntegrationsClient } from "../types";
import {
  CHARGE_TRANSACTION_TYPES, chargeToExpenseRow, feesByLineItem, fillEmptyFees,
  type ChargeExpenseRow, type EbayFinanceTransaction,
} from "./financesMap";

const IN_CHUNK = 200; // Supabase .in() chunk size (same as ImportSalesModal)

export interface ChargeSyncResult { chargesImported: number; chargesAlreadyImported: number; skippedCurrency: number; ordersFeesFilled: number }
/** RLS refused the write (Expenses or Orders below Edit). */
export class ChargeSyncPermissionError extends Error {}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function applyFinanceTransactions(
  client: IntegrationsClient,
  txns: EbayFinanceTransaction[],
  ctx: { createdBy: string; connectionId: string; accountLabel: string }
): Promise<ChargeSyncResult> {
  const result: ChargeSyncResult = { chargesImported: 0, chargesAlreadyImported: 0, skippedCurrency: 0, ordersFeesFilled: 0 };

  // 1. Account charges → expenses, deduped on external_ref.
  const rows: ChargeExpenseRow[] = [];
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
    const row = chargeToExpenseRow(txn, ctx);
    if (row) rows.push(row); else result.skippedCurrency++;
  }
  for (const batch of chunks(rows, IN_CHUNK)) {
    const { data, error } = await client
      .from("expenses")
      .upsert(batch, { onConflict: "external_ref", ignoreDuplicates: true })
      .select("id");
    if (error) {
      if (error.code === "42501") throw new ChargeSyncPermissionError(error.message);
      throw new Error(`expenses upsert failed: ${error.message}`);
    }
    const inserted = data?.length ?? 0;
    result.chargesImported += inserted;
    result.chargesAlreadyImported += batch.length - inserted;
  }

  // 2. Per-order fees → fill still-empty fees on already-imported sales.
  const fees = feesByLineItem(txns);
  for (const ids of chunks([...fees.keys()], IN_CHUNK)) {
    const { data, error } = await client
      .from("sales")
      .select("id, external_order_id, platform_fee, advertising_fee")
      .eq("platform", "ebay")
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    for (const sale of (data ?? []) as { id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null }[]) {
      const patch = fillEmptyFees(sale, fees.get(sale.external_order_id)!);
      if (!patch) continue;
      const { error: upErr } = await client.from("sales").update(patch).eq("id", sale.id);
      if (upErr) {
        if (upErr.code === "42501") throw new ChargeSyncPermissionError(upErr.message);
        throw new Error(`sales fee update failed: ${upErr.message}`);
      }
      result.ordersFeesFilled++;
    }
  }
  return result;
}
```

If `IntegrationsClient` (`Pick<SupabaseClient, "from">`) types reject `.upsert(...).select(...)` or `.update(...).eq(...)`, keep the type. Those methods exist on the real builder; the problem would only be the fake in tests, which is cast `as never`.

- [ ] **Step 4: Run the test**

Run: `npx jest src/lib/integrations/ebay/chargeSync`
Expected: PASS.

- [ ] **Step 5: Implement the route**

```ts
// src/app/api/integrations/ebay/charges/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { fetchFinanceTransactions, FinancesScopeError } from "@/lib/integrations/ebay/finances";
import { applyFinanceTransactions, ChargeSyncPermissionError } from "@/lib/integrations/ebay/chargeSync";
import { CHARGE_TRANSACTION_TYPES } from "@/lib/integrations/ebay/financesMap";
import { accountLabel } from "@/lib/utils/platformAccounts";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000; // same window as Review Orders

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[ebay/charges/sync] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const { connectionId } = (await req.json().catch(() => ({}))) as { connectionId?: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 });

  try {
    const conn = await requireActiveConnection(client, connectionId, ent);
    if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });

    const token = await ensureValidAccessToken(client, conn, getAdapter("ebay"));
    const to = new Date();
    const txns = await fetchFinanceTransactions(token, {
      from: new Date(to.getTime() - LOOKBACK_MS).toISOString(),
      to: to.toISOString(),
      types: ["SALE", ...CHARGE_TRANSACTION_TYPES],
      marketplaceId: conn.marketplace_id,
    });
    const result = await applyFinanceTransactions(client, txns, {
      createdBy: userId, connectionId: conn.id, accountLabel: accountLabel(conn),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IntegrationAccountError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    if (err instanceof FinancesScopeError) {
      return NextResponse.json({ error: "INTEGRATION_FINANCES_SCOPE" }, { status: 409 });
    }
    if (err instanceof ChargeSyncPermissionError) {
      return NextResponse.json({ error: "You don't have permission to add expenses or edit orders." }, { status: 403 });
    }
    console.error("[ebay/charges/sync] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't sync eBay charges. Please try again." }, { status: 502 });
  }
}
```

`IntegrationAccountError` carries its code in `.code` (and as `.message`), so the UI's `integrationErrorMessage` maps it. Prefer `err.code` in the response for clarity.

- [ ] **Step 6: Verifier + commit**

Run: `uv run .claude/verifiers/verify_changes.py`
Expected: no new findings for the route (it has an auth guard and no raw errors).

```bash
git add src/lib/integrations/ebay/chargeSync.ts src/lib/integrations/ebay/chargeSync.test.ts src/app/api/integrations/ebay/charges
git commit -m "feat(integrations): sync eBay account charges into Expenses and fill empty order fees"
```

---

### Task 6: Review Orders fee prefill

**Files:**
- Modify: `src/app/api/integrations/review/route.ts` (`ReviewOrder` type, and the per-connection loop at ~lines 70-95)
- Create: `src/app/dashboard/integrations/review/_lib/seedOrderFees.ts`, `seedOrderFees.test.ts`
- Modify: `src/app/dashboard/integrations/review/page.tsx` (initial-load `useEffect`, ~line 121-135)

**Interfaces:**
- Consumes: `fetchFinanceTransactions`, `FinancesScopeError` (Task 4); `feesByLineItem`, `LineItemFees` (Task 3).
- Produces: `ReviewOrder.fees?: LineItemFees`; `seedOrderFees(data: ReviewResponse, prev: Record<string, {advertisingFee: string; platformFee: string}>): Record<string, {advertisingFee: string; platformFee: string}>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/dashboard/integrations/review/_lib/seedOrderFees.test.ts
import { seedOrderFees } from "./seedOrderFees";
import type { ReviewResponse } from "@/app/api/integrations/review/route";

const order = (id: string, extra: object) => ({
  external_order_id: id, product_name: "x", quantity: 1, unit_price: 1, total_amount: 1, currency: "EUR",
  date: "2026-10-01", status: "pending", description: null, imported: false, connection_id: "c1", account_name: "Shop",
  ...extra,
});

describe("seedOrderFees", () => {
  it("prefills fees for not-yet-imported orders as strings, leaving nulls blank", () => {
    const data = { ebay: { orders: [order("O1:L1", { fees: { platformFee: 1.2, advertisingFee: null } })] } } as ReviewResponse;
    expect(seedOrderFees(data, {})).toEqual({ "O1:L1": { platformFee: "1.2", advertisingFee: "" } });
  });

  it("skips imported orders and orders without fees, and never overwrites existing state", () => {
    const data = {
      ebay: { orders: [
        order("A", { imported: true, fees: { platformFee: 1, advertisingFee: 1 } }),
        order("B", {}),
        order("C", { fees: { platformFee: 9, advertisingFee: 9 } }),
      ] },
    } as ReviewResponse;
    const prev = { C: { platformFee: "2", advertisingFee: "" } };
    expect(seedOrderFees(data, prev)).toEqual(prev);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx jest dashboard/integrations/review/_lib/seedOrderFees`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/app/dashboard/integrations/review/_lib/seedOrderFees.ts
import type { ReviewResponse } from "@/app/api/integrations/review/route";

type FeeInputs = Record<string, { advertisingFee: string; platformFee: string }>;

/** eBay-reported fees as the page's editable fee inputs. Existing entries (user edits) win. */
export function seedOrderFees(data: ReviewResponse, prev: FeeInputs): FeeInputs {
  const next: FeeInputs = { ...prev };
  for (const bucket of [data.ebay, data.amazon]) {
    for (const o of bucket?.orders ?? []) {
      if (o.imported || !o.fees || next[o.external_order_id]) continue;
      next[o.external_order_id] = {
        platformFee: o.fees.platformFee === null ? "" : String(o.fees.platformFee),
        advertisingFee: o.fees.advertisingFee === null ? "" : String(o.fees.advertisingFee),
      };
    }
  }
  return next;
}
```

- [ ] **Step 4: Wire the route.** In `review/route.ts`:

```ts
import { fetchFinanceTransactions, FinancesScopeError } from "@/lib/integrations/ebay/finances";
import { feesByLineItem, type LineItemFees } from "@/lib/integrations/ebay/financesMap";
import { INTEGRATION_ERRORS } from "@/lib/utils/integrationErrors";

export type ReviewOrder = NormalizedOrder & {
  imported: boolean; connection_id: string; account_name: string;
  /** eBay-reported fees from the Finances API (eBay only; absent when unavailable). */
  fees?: LineItemFees;
};
```

Inside the per-connection `try`, after `const orders = await adapter.fetchOrders(...)`:

```ts
        let fees = new Map<string, LineItemFees>();
        if (conn.platform === "ebay") {
          try {
            fees = feesByLineItem(await fetchFinanceTransactions(token, {
              from: since, to: new Date().toISOString(), types: ["SALE"], marketplaceId: conn.marketplace_id,
            }));
          } catch (err) {
            // Fee prefill must never block order review.
            if (err instanceof FinancesScopeError) errors[conn.id] = `${name}: ${INTEGRATION_ERRORS.INTEGRATION_FINANCES_SCOPE}`;
            else console.error(`[integrations/review] finances fetch failed (connection=${conn.id}):`, err instanceof Error ? err.message : err);
          }
        }
```

In the `orders.map(...)` spread add `fees: fees.get(o.external_order_id),`.

- [ ] **Step 5: Wire the page.** In the initial-load `useEffect` of `review/page.tsx`, right after `setData(d);` add `setOrderFees((prev) => seedOrderFees(d, prev));` and import `seedOrderFees` from `./_lib/seedOrderFees`. Make sure the page's existing error rendering for `data.errors` still shows the per-account message (it now also covers the reconnect hint).

- [ ] **Step 6: Run tests**

Run: `npx jest dashboard/integrations src/lib/integrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/integrations/review/route.ts src/app/dashboard/integrations/review
git commit -m "feat(integrations): prefill eBay order fees on Review Orders from the Finances API"
```

---

### Task 7: "Sync eBay charges" button + docs

**Files:**
- Modify: `src/app/dashboard/integrations/_components/ConnectionCard.tsx`
- Modify: `src/app/dashboard/integrations/CLAUDE.md`, `src/app/dashboard/integrations/SKILL.md`, `src/lib/integrations/SKILL.md`, `AGENTS.md` (the `src/lib/integrations/` bullet: one clause about Finances)

**Interfaces:**
- Consumes: `POST /api/integrations/ebay/charges/sync` → `ChargeSyncResult` | `{ error }` (Task 5); `integrationErrorMessage` (existing).

- [ ] **Step 1: Add state and handler** in `ConnectionCard` (import `RefreshCw` from `lucide-react`):

```tsx
  const [syncingCharges, setSyncingCharges] = useState(false);

  async function handleSyncCharges() {
    setSyncingCharges(true);
    try {
      const res = await fetch("/api/integrations/ebay/charges/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string; chargesImported?: number; chargesAlreadyImported?: number; skippedCurrency?: number; ordersFeesFilled?: number;
      };
      if (!res.ok) {
        toastError("Couldn't sync eBay charges", integrationErrorMessage(json.error, json.error ?? "Please try again."));
        return;
      }
      const skipped = json.skippedCurrency ? `, ${json.skippedCurrency} skipped (unsupported currency)` : "";
      success(
        "eBay charges synced",
        `${json.chargesImported ?? 0} new expenses, ${json.ordersFeesFilled ?? 0} orders got fees${skipped}.`
      );
    } catch {
      toastError("Couldn't sync eBay charges", "Please try again.");
    } finally {
      setSyncingCharges(false);
    }
  }
```

- [ ] **Step 2: Render the button** inside the `{connected && (<>…</>)}` group, before the "Review orders" link:

```tsx
              {platform === "ebay" && state === "active" && (
                <Button size="sm" variant="secondary" onClick={handleSyncCharges} disabled={syncingCharges}>
                  <RefreshCw size={14} className={syncingCharges ? "animate-spin" : undefined} />
                  {syncingCharges ? "Syncing…" : "Sync eBay charges"}
                </Button>
              )}
```

- [ ] **Step 3: Docs.**
  - `dashboard/integrations/CLAUDE.md`: the card's new button, which calls `/api/integrations/ebay/charges/sync`; review page fee prefill via `_lib/seedOrderFees.ts`.
  - `dashboard/integrations/SKILL.md` gotcha: Finances needs `sell.finances`, older connections get `INTEGRATION_FINANCES_SCOPE` until reconnected; prefill never blocks order review; sync fills only NULL fees.
  - `src/lib/integrations/SKILL.md`: file map for `ebay/finances.ts`, `ebay/financesMap.ts`, `ebay/chargeSync.ts`. Gotchas: apiz host, ad-fee name variants (`isAdFeeType`), `bookingEntry: CREDIT` means a negative expense, `external_ref` dedup with a full unique index, `vendor: "eBay"` feeds the running balance.
  - `AGENTS.md`: add "eBay Finances (fees + account charges → Expenses, 058)" to the `src/lib/integrations/` bullet.

- [ ] **Step 4: Run the feature tests**

Run: `npx jest dashboard/integrations dashboard/expenses src/lib/integrations src/lib/utils/expenseCategories`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/integrations src/lib/integrations/SKILL.md AGENTS.md
git commit -m "feat(integrations): Sync eBay charges button + docs"
```

---

### Task 8: Hand-off checks (user-run)

- [ ] Apply 058 to Project B (user's call; then flip `supabase/SKILL.md` to Applied with the date).
- [ ] Reconnect one eBay account (it needs the new scope).
- [ ] Integrations → Sync eBay charges: check that the Expenses rows have the right categories, that credits are negative, and that a second press imports 0 new rows.
- [ ] Review Orders: check that the fee inputs are prefilled for un-imported eBay orders, and that a not-yet-reconnected account shows the reconnect hint while its orders still load.
- [ ] Push the branch and open a PR (the pre-push hook runs jest + build).
