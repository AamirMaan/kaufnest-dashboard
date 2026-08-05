# Amazon Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Amazon importer treat `SALE` and `REFUND` as the only meaningful rows — a refund deducts its amount from the sale it belongs to — and discard `RETURN`/`FC_TRANSFER` as noise without erroring on their empty fields.

**Architecture:** `classifySkip`'s non-sale set inverts (`refund` out, `return` in). A new `isRefund` parse branch carries positive magnitudes and an explicit match target, with `data: null` because a refund never becomes a row. The modal replaces its return machinery with the same shape retargeted at refunds, adjusting the matched sale in place and guarding re-imports with a new `refunded_amount` column.

**Tech Stack:** TypeScript, Jest, Next.js App Router, Redux Toolkit, Supabase/Postgres.

**Source spec:** `docs/superpowers/specs/2026-08-05-amazon-refunds-design.md`

## Global Constraints

- **The insert runs BEFORE the refund loop.** A SALE and its REFUND appear in the same monthly file — all four real examples do — so matching first queries `sales` before the SALE row exists and drops every refund. This was a Critical on the previous branch.
- **REFUND rows must be exempt from BOTH `markDuplicates` passes.** They carry an `external_order_id` by definition; without the carve-out every refund is marked "order already exists" and the feature is unreachable. Also a Critical on the previous branch.
- **`refunded` is a NEW status. Never reuse `returned`.** `isRevenueSale` (`src/lib/utils/filters.ts:153-155`) excludes `returned` and `cancelled`; `refunded` must pass through so the reduced `total_amount` still counts as revenue. **Do not modify `isRevenueSale`.**
- **A sale whose `refunded_amount` is already set is a no-op** — never re-subtracted. Without this, re-importing deducts twice.
- **REFUND rows have an EMPTY `date` column**, like RETURN rows. The refund branch must run BEFORE the date parse.
- Refund magnitudes are stored **positive**. Amazon writes them negative; `Math.abs` at the parse boundary so the modal subtracts rather than adding a negative.
- `importFormats.ts` is a **pure module** — no React, Supabase or Redux imports.
- `generic` and `ebay` must keep their behaviour exactly. Only `amazon` changes.
- Tenant DDL goes through `SELECT public.run_on_all_tenant_schemas($$ … {{schema}} … $$)`, must be idempotent, and must be mirrored into `provision_tenant_schema()` in `005_tenant_provisioning.sql` (the 2-places rule).
- **Never commit to `main`.** Work happens on `feat/amazon-refunds` (already created off `main` @ `90a7734`).
- **Every commit must leave the tree type-clean.** `.husky/pre-commit` runs `tsc --noEmit`, `eslint` and the project verifier, so a commit that depends on a later task to compile is simply rejected. This is why Task 2 leaves `ParsedRow.isReturn` in place and Task 3 removes it together with its consumer. Do not `--no-verify`.
- Do **not** run `npm test`, `npx tsc --noEmit`, `npm run lint`, or a dev server. You MAY run `npx jest src/app/dashboard/sales`. The user runs the full gates.
- Do **not** apply migrations. The Supabase MCP servers are `read_only=true`; the user applies them.
- Docs ship in the **same commit** as the code (AGENTS.md).

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/031_sales_refunded_amount.sql` | the new column, fanned out |
| `supabase/migrations/005_tenant_provisioning.sql` | 2-places mirror |
| `src/types/index.ts` | `Sale.refunded_amount`, excluded from `SaleImportData` |
| `src/components/ui/Badge.tsx` | `refunded` variant |
| `src/app/dashboard/sales/_components/orderStatus.ts` | `refunded` as a preset status |
| `src/app/dashboard/sales/_components/importFormats.ts` + test | skip inversion, refund parse branch |
| `src/app/dashboard/sales/_components/ImportSalesModal.tsx` | remove returns, add refunds |
| `src/app/dashboard/sales/page.tsx` | summary toast |
| docs | `sales/CLAUDE.md`, `sales/SKILL.md`, `supabase/SKILL.md`, `supabase/CLAUDE.md` |

---

### Task 1: Schema, type and badge

**Files:**
- Create: `supabase/migrations/031_sales_refunded_amount.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`
- Modify: `src/types/index.ts`
- Modify: `src/components/ui/Badge.tsx`
- Modify: `src/app/dashboard/sales/_components/orderStatus.ts` (+ its test if it asserts the array)
- Modify: `supabase/SKILL.md`, `supabase/CLAUDE.md`

**Interfaces:**
- Produces: `Sale.refunded_amount: number | null`; `SaleImportData` explicitly EXCLUDES it. Tasks 2 and 3 rely on that exclusion.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/031_sales_refunded_amount.sql`:

```sql
-- ============================================================
-- 031 — sales.refunded_amount
--
-- Amazon REFUND rows deduct from the sale they belong to rather than becoming
-- their own row: `sales_unit_price_check (unit_price >= 0)` rejects a negative
-- unit price, and `idx_sales_platform_external_order_id` is a NON-partial
-- unique index, while every refund shares its order id with its own sale.
--
-- This column is the idempotency marker. A sale whose refunded_amount is
-- already set is skipped on re-import instead of being deducted a second time.
--
-- Also baked into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists refunded_amount numeric(12,2)
      check (refunded_amount >= 0);
$$);
```

- [ ] **Step 2: Mirror it into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, find the `CREATE TABLE IF NOT EXISTS %1$I.sales` block and add this column beside the other nullable money columns:

```sql
      refunded_amount   numeric(12,2) CHECK (refunded_amount >= 0),
```

Change nothing else in that function.

- [ ] **Step 3: Add the type, and exclude it from the import shape**

In `src/types/index.ts`, add to the `Sale` interface after `restock`:

```typescript
  /**
   * Total refunded against this order, set by the Amazon REFUND import path.
   * Non-null means a refund has already been deducted from `total_amount` —
   * the importer treats such a sale as a no-op so a re-import cannot deduct
   * twice. Null means no refund has been applied.
   */
  refunded_amount: number | null;
```

Then in `importFormats.ts`, extend the `SaleImportData` omit list so the import path never sets it:

```typescript
export type SaleImportData = Omit<
  Sale,
  "id" | "created_by" | "created_at" | "product_id" | "refunded_amount"
>;
```

Without this every `SaleImportData` literal in the file fails to compile.

`refunded_amount` is required-and-nullable, matching how every other nullable column on `Sale` is typed (`vat_rate: number | null`, `product_id: string | null`). That is deliberate and consistent — but it means **every full `Sale` object literal in the repo must now supply it**, and `.husky/pre-commit` runs `tsc --noEmit`, so missing one blocks the commit. Add `refunded_amount: null` to the `Sale` literals in:

- `src/app/dashboard/sales/_store/salesSlice.test.ts` (the `makeSale` defaults)
- `src/app/dashboard/_lib/aggregateSales.test.ts` (`const defaults: Sale`)
- `src/lib/utils/filters.test.ts` (`makeSale`)
- `src/lib/integrations/mergeImportedSale.test.ts` (`existingSale` and `incomingSale`)
- `src/app/dashboard/sales/_components/orderMath.test.ts` (`makeSale`)

Then search the non-test sources for any remaining full `Sale` literal — `src/lib/integrations/mapToSale.ts` and `mergeImportedSale.ts` are the likely ones — and add it there too. Files using `Partial<Sale>` with a cast (e.g. `src/lib/utils/invoiceMath.test.ts`) need no change.

Do not "fix" this by making the field optional. Optional would let a real code path forget to read it and silently skip the idempotency guard.

- [ ] **Step 4: Add the badge variant**

In `src/components/ui/Badge.tsx`, beside `returned: "danger"` and `cancelled: "warning"`:

```typescript
  refunded: "warning",
```

`refunded` is deliberately NOT `danger` — unlike `returned` it still counts as revenue at its reduced value.

- [ ] **Step 5: Make `refunded` a preset status**

In `src/app/dashboard/sales/_components/orderStatus.ts`, add `"refunded"` to the `ORDER_STATUSES` array, after `"returned"`.

Without this, `isPresetStatus("refunded")` returns false, so `EditSaleModal` renders every refunded order in its "Other…" free-text box rather than the dropdown, and the status appears in the Sales filter only as a stray custom value. `statusLabel` and the `PresetOrderStatus` type both derive from this array, so no other change is needed.

Check `orderStatus.test.ts` for a test asserting the exact contents or length of `ORDER_STATUSES` and update it if one exists.

- [ ] **Step 6: Document the migration**

Add a `031_sales_refunded_amount.sql` row to `supabase/SKILL.md`'s file-map/apply-status table, using the same "not yet applied" marker the neighbouring 027–030 rows use, and a matching entry in `supabase/CLAUDE.md`. State that `provision_tenant_schema()` was updated in the same commit — because it was.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/031_sales_refunded_amount.sql supabase/migrations/005_tenant_provisioning.sql src/types/index.ts src/components/ui/Badge.tsx src/app/dashboard/sales/_components/orderStatus.ts src/app/dashboard/sales/_components/orderStatus.test.ts supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(sales): add refunded_amount and a refunded order status

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Invert the skip set and parse REFUND rows

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Consumes: the `SaleImportData` omit change from Task 1.
- Produces on `ParsedRow`:
  ```typescript
  isRefund?: boolean;
  refund?: {
    platform: Platform;
    externalOrderId: string;
    amount: number;            // positive magnitude
    vatAmount: number | null;  // positive magnitude
  };
  ```
  A refund row has `data: null`. Task 3 reads `isRefund` and `refund`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("Amazon REFUND rows", () => {
  // Order 304-8612000-9060321 from the April 2026 report. Note `date` is EMPTY
  // on a REFUND row, exactly as on a RETURN row.
  const refundRow = {
    order_id: "304-8612000-9060321",
    date: "",
    product_name: "Textilstifte",
    quantity: "1",
    sku: "K2T-PFM-024",
    status: "REFUND",
    unit_price: "-7.99",
    total: "-7.99",
    vat_amount: "0",
    currency: "EUR",
  };

  it("parses despite an empty date and negative amounts", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.error).toBeNull();
    expect(row.isRefund).toBe(true);
  });

  it("carries a POSITIVE magnitude, not the negative sheet value", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.refund?.amount).toBe(7.99);
    expect(row.refund?.vatAmount).toBe(0);
  });

  it("carries the match target and sku", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.refund?.externalOrderId).toBe("304-8612000-9060321");
    expect(row.refund?.platform).toBe("amazon");
    expect(row.sku).toBe("K2T-PFM-024");
  });

  it("produces no insertable data — a refund never becomes a row", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.data).toBeNull();
  });

  it("errors when the order_id is missing", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.amazon,
      { ...refundRow, order_id: "" },
      2,
    );
    expect(row.error).toContain("order_id");
  });

  it("errors on a zero refund amount", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.amazon,
      { ...refundRow, total: "0", unit_price: "0" },
      2,
    );
    expect(row.error).toContain("total");
  });

  it("leaves vatAmount null when the column is absent", () => {
    const { vat_amount, ...noVat } = refundRow;
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, noVat, 2);
    expect(row.refund?.vatAmount).toBeNull();
  });
});

describe("RETURN and FC_TRANSFER are now noise", () => {
  it("skips a RETURN row with an empty date instead of erroring", () => {
    // This is the exact `Row 21: invalid or missing "date"` failure.
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "306-2809374-5735538",
      date: "",
      product_name: "Baumwolltasche",
      quantity: "1",
      sku: "100-CNC-2832-10P",
      status: "RETURN",
    }, 21);
    expect(row.error).toBeNull();
    expect(row.skipped).toBe("not a sale");
    expect(row.data).toBeNull();
  });

  it("still skips FC_TRANSFER", () => {
    expect(classifySkip(IMPORT_FORMATS.amazon, {
      order_id: "x", date: "28-04-2026", product_name: "W",
      quantity: "10", status: "FC_TRANSFER",
    })).toBe("not a sale");
  });

  it("no longer skips REFUND", () => {
    expect(classifySkip(IMPORT_FORMATS.amazon, {
      order_id: "x", date: "", product_name: "W",
      quantity: "1", status: "REFUND",
    })).toBeNull();
  });

  it("leaves a SALE row completely unaffected", () => {
    // The 20 Apr sale that the refund above belongs to. Regression guard: the
    // new branch sits in the middle of validateRowForFormat, so it must not
    // intercept anything that is not a REFUND.
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "304-8612000-9060321",
      date: "20-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      sku: "K2T-PFM-024",
      status: "SALE",
      unit_price: "8.05",
      total: "8.05",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.isRefund).toBeUndefined();
    expect(row.data?.total_amount).toBe(8.05);
    expect(row.data?.date).toBe("2026-04-20");
  });

  it("still skips nothing for the generic format", () => {
    expect(classifySkip(IMPORT_FORMATS.generic, {
      order_id: "x", date: "", product_name: "W",
      quantity: "1", status: "RETURN",
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — `isRefund` does not exist, `REFUND` is still skipped, and the RETURN row errors on its empty date.

- [ ] **Step 3: Invert the non-sale set**

Replace the `NON_SALE_STATUSES` constant and its comment:

```typescript
/**
 * Amazon row types that carry no importable money. REFUND is deliberately NOT
 * here — its negative amounts are deducted from the sale they belong to. RETURN
 * is pure logistics: it duplicates a refund that already appears separately, and
 * its rows have no `date` at all.
 */
const NON_SALE_STATUSES = new Set(["return", "fc_transfer"]);
```

- [ ] **Step 4: Replace the return branch with a refund branch**

Add the following to `ParsedRow`, **alongside the existing `isReturn` field — do not delete that one yet.** Its only consumer is `ImportSalesModal.tsx`, which Task 3 rewrites; deleting the field here would break that file, and `.husky/pre-commit` runs `tsc --noEmit`, so this task's commit would be rejected. Task 3 removes the field and its consumer together.

```typescript
  /**
   * Amazon REFUND row. Never inserted — the modal matches it to an existing
   * sale and deducts `refund.amount` from that sale's `total_amount`. `data`
   * is null because there is no row to create.
   */
  isRefund?: boolean;
  refund?: {
    platform: Platform;
    externalOrderId: string;
    /** Positive magnitude. Amazon writes refunds negative; abs() at the boundary. */
    amount: number;
    /** Positive magnitude, or null when the sheet has no vat_amount column. */
    vatAmount: number | null;
  };
```

Then delete the `isReturnRow` const and the whole `if (isReturnRow) { … }` block — with `return` now in `NON_SALE_STATUSES`, that branch is unreachable. Nothing outside this file reads it, so removing it keeps the tree type-clean.

In its place, add the refund branch. It must sit **before** the date parse, because REFUND rows have an empty `date`:

```typescript
  const isRefundRow =
    !!format.priceColumnsAreLineTotals && raw.status?.trim().toLowerCase() === "refund";

  if (isRefundRow) {
    // REFUND rows have an EMPTY `date` column and negative money, so neither
    // the date parse nor the amazon price branch can run on them. They adjust
    // an existing sale rather than becoming one.
    const refundOrderId = raw.order_id?.trim() || null;
    if (!refundOrderId) return fail(`missing "order_id"`);

    const amountRaw = raw.total?.trim() || raw.unit_price?.trim();
    const parsedAmount = amountRaw ? parseLocaleNumber(amountRaw) : null;
    if (parsedAmount === null || parsedAmount === 0) {
      return fail(`"total" must be a non-zero number on a REFUND row`);
    }

    const vatRaw = raw.vat_amount?.trim();
    const parsedVat = vatRaw ? parseLocaleNumber(vatRaw) : null;

    return {
      rowNum,
      isRefund: true,
      sku: raw.sku?.trim() || null,
      error: null,
      data: null,
      refund: {
        platform,
        externalOrderId: refundOrderId,
        amount: Math.abs(round2(parsedAmount)),
        vatAmount: parsedVat === null ? null : Math.abs(round2(parsedVat)),
      },
    };
  }

  const date = parseFlexibleDate(raw.date, dateOrder);
```

Keep everything after the date parse exactly as it is. `platform`, `productName` and `quantity` are already resolved above this point — do not re-parse them.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS. Pre-existing RETURN tests will fail until you delete them — they assert behaviour this task deliberately removes. Delete only those, and say in your report exactly which you removed and why.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "feat(sales-import): parse Amazon REFUND rows, discard RETURN

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Modal — replace return machinery with refunds

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`
- Modify: `src/app/dashboard/sales/_components/importFormats.ts` (drop the orphaned `isReturn` field only)
- Modify: `src/app/dashboard/sales/page.tsx`

**Interfaces:**
- Consumes: `ParsedRow.isRefund` and `ParsedRow.refund` (Task 2); `Sale.refunded_amount` (Task 1).
- Produces: `ImportSummary { inserted; refundsApplied; refundsSkipped; refundsAlreadyApplied }`, consumed by `page.tsx`.

- [ ] **Step 1: Remove the return machinery**

First delete the now-orphaned `isReturn?: boolean` field and its JSDoc from `ParsedRow` in `_components/importFormats.ts`. Task 2 left it in place only so the modal would keep compiling; nothing writes it any more. It must come out in the same commit as its consumers below, or `tsc` fails either way round.

Then delete, in `ImportSalesModal.tsx`: the `restockReturns` state and its checkbox, the `returnRows`/`unmatchedReturns`/`alreadyAppliedReturns` locals and the whole return loop, the `returns_*` audit fields, and the `returnsMatched`/`returnsSkipped`/`returnsAlreadyApplied` summary fields. Replace the `ImportSummary` interface with:

```typescript
/**
 * `refundsAlreadyApplied` counts refunds whose sale already had a
 * refunded_amount — deducting again on a re-import would halve the order.
 */
export interface ImportSummary {
  inserted: number;
  refundsApplied: number;
  refundsSkipped: number;
  refundsAlreadyApplied: number;
}
```

- [ ] **Step 2: Carve refunds out of both dedup passes**

In `markDuplicates`, the two `if (r.isReturn) return r;` guards and the `!r.isReturn` condition in the byPlatform collection loop all become `isRefund`:

```typescript
      // REFUND rows are not new orders. They carry the external_order_id of an
      // EXISTING sale by definition, so the dedup passes would mark every one
      // "order already exists" and drop it before matching could run.
      if (r.isRefund) return r;
```

and in the collection loop: `if (!r.isRefund && r.data?.external_order_id && !r.skipped) {`.

- [ ] **Step 3: Collect refunds from `parsed`, not `importable`**

A refund has `data: null`, so it is excluded from `importable` by design. Collect it directly:

```typescript
    const refundRows = parsed.filter((r) => r.isRefund && !r.skipped);
    const insertRows = importable.filter((r) => !r.isRefund);
```

`importable` already requires `data !== null`, so no refund can reach `payload`.

- [ ] **Step 4: Allow a refunds-only import**

A refund has `data: null`, so it is not in `importable` — which means a file of only refunds currently cannot be imported at all, and the button reads "Import 0 rows". Add a count beside the existing ones at `ImportSalesModal.tsx:146-149` and widen both.

```typescript
  const refundCount = parsed.filter((r) => r.isRefund && !r.skipped).length;
  const canImport =
    parsed.length > 0 &&
    errors.length === 0 &&
    (importable.length > 0 || refundCount > 0) &&
    !checking;
```

Then fix the button label at `ImportSalesModal.tsx:553`, which hardcodes `importable.length`. Introduce `const actionableCount = importable.length + refundCount;` and use it for both the count and the pluralisation, leaving the `loading`/`checking` branches untouched.

Leave `skuMatchCount` (line 163) reading `importable` — it reports how many rows will link to inventory, and a refund never creates one.

- [ ] **Step 5: Apply refunds AFTER the insert**

Place this after the insert block and its error bail — never before. Every real refund shares its file with its own SALE row, so matching first finds nothing.

```typescript
    const unmatchedRefunds: ParsedRow[] = [];
    const alreadyRefunded: ParsedRow[] = [];
    for (const r of refundRows) {
      const target = r.refund!;
      const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
      if (!productId) {
        unmatchedRefunds.push({ ...r, skipped: "refund: no matching order" });
        continue;
      }
      const { data: match, error: matchErr } = await supabase
        .from("sales")
        .select("*")
        .eq("platform", target.platform)
        .eq("external_order_id", target.externalOrderId)
        .eq("product_id", productId)
        .limit(1);
      if (matchErr) {
        setImportError("Could not check existing orders for refunds. Please try again.");
        setLoading(false);
        return;
      }
      if (!match || match.length === 0) {
        unmatchedRefunds.push({ ...r, skipped: "refund: no matching order" });
        continue;
      }
      const previous = match[0] as Sale;

      // Already refunded → no-op. Deducting again would halve the order.
      if (previous.refunded_amount !== null) {
        alreadyRefunded.push({ ...r, skipped: "refund already applied" });
        continue;
      }

      if (target.amount > previous.total_amount) {
        setImportError(
          `Refund of ${target.amount} exceeds order ${target.externalOrderId} (${previous.total_amount}). No refunds were applied.`,
        );
        setLoading(false);
        return;
      }

      const nextVat =
        previous.vat_amount === null || target.vatAmount === null
          ? previous.vat_amount
          : Math.round((previous.vat_amount - target.vatAmount) * 100) / 100;

      const { data: updated, error: updErr } = await supabase
        .from("sales")
        .update({
          total_amount: Math.round((previous.total_amount - target.amount) * 100) / 100,
          vat_amount: nextVat,
          status: "refunded",
          refunded_amount: target.amount,
        })
        .eq("id", previous.id)
        .select()
        .single<Sale>();
      if (updErr || !updated) {
        setImportError("Could not apply a refund. Please try again.");
        setLoading(false);
        return;
      }
      dispatch(updateSale(updated));
    }
```

Follow the existing `writeAuditLog` call in this file to record a per-sale entry for each applied refund, matching its exact signature and metadata conventions — read a sibling call site rather than inventing a shape.

- [ ] **Step 6: Reflect skips and report the summary**

Fold `unmatchedRefunds` and `alreadyRefunded` back into `parsed` so the existing skip-reason grouping renders them, and pass the counts to `onSuccess`:

```typescript
    const refundsApplied =
      refundRows.length - unmatchedRefunds.length - alreadyRefunded.length;
    onSuccess({
      inserted: inserted.length,
      refundsApplied,
      refundsSkipped: unmatchedRefunds.length,
      refundsAlreadyApplied: alreadyRefunded.length,
    });
```

- [ ] **Step 7: Update the toast in `page.tsx`**

Replace the `onSuccess` handler's destructuring and its four `parts.push` lines so it reports refunds instead of returns. Keep the existing shape — a `warning` variant when nothing happened, `success` otherwise:

```tsx
        onSuccess={({ inserted, refundsApplied, refundsSkipped, refundsAlreadyApplied }) => {
          const parts: string[] = [];
          if (inserted > 0) parts.push(`${inserted} order${inserted !== 1 ? "s" : ""} imported successfully.`);
          if (refundsApplied > 0) parts.push(`${refundsApplied} refund${refundsApplied !== 1 ? "s" : ""} applied.`);
          if (refundsSkipped > 0) parts.push(`${refundsSkipped} refund${refundsSkipped !== 1 ? "s" : ""} skipped — no matching order found.`);
          if (refundsAlreadyApplied > 0) parts.push(`${refundsAlreadyApplied} refund${refundsAlreadyApplied !== 1 ? "s" : ""} already applied — no change.`);
          const description = parts.length > 0 ? parts.join(" ") : "Nothing to import.";
          if (inserted === 0 && refundsApplied === 0) {
            warning("No orders imported", description);
          } else {
            success("Import complete", description);
          }
        }}
```

- [ ] **Step 8: Ask the user to verify in the browser**

Do not start a dev server. Ask the user to import the April Amazon sheet and confirm: `RETURN` and `FC_TRANSFER` rows appear in the skip summary rather than erroring; order `304-8612000-9060321` ends at `total_amount` 0.06 with status `refunded`; and **re-importing the same file reports the refunds as already applied and does not change any total**.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/sales/_components/ImportSalesModal.tsx src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/page.tsx
git commit -m "feat(sales-import): deduct Amazon refunds from their matched sale

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Documentation

**Files:**
- Modify: `src/app/dashboard/sales/CLAUDE.md`
- Modify: `src/app/dashboard/sales/SKILL.md`

- [ ] **Step 1: `sales/CLAUDE.md`**

Its CSV-import section documents the RETURN match-and-flip flow, the restock toggle and the returns summary — all removed. Rewrite it to describe: the SALE/REFUND routing, that RETURN and FC_TRANSFER are skipped, that the insert runs before the refund loop, and the `ImportSummary` fields (`inserted`, `refundsApplied`, `refundsSkipped`, `refundsAlreadyApplied`).

Also add one line to its "Order status + returns" section: the Gross/VAT/Net summary in `page.tsx` and `effectiveSales` on the Overview page exclude `returned` and `cancelled` only, so a `refunded` order stays in both totals **at its reduced `total_amount`** — that is deliberate, and it is what makes the figures match Amazon's net. Do not add `refunded` to either exclusion.

- [ ] **Step 2: `sales/SKILL.md` gotchas**

Delete the RETURN gotchas, which now describe removed code, and add these four:

> `REFUND` rows have an EMPTY `date` column, exactly like `RETURN` rows did. The refund parse branch therefore runs BEFORE the date parse. Moving it after reintroduces the `Row 21: invalid or missing "date"` failure.

> A refund deducts from its matched sale rather than becoming a row. `sales_unit_price_check (unit_price >= 0)` rejects a negative unit price, and `idx_sales_platform_external_order_id` is a NON-partial unique index while every refund shares its order id with its own sale.

> The status is `refunded`, never `returned`. `isRevenueSale` excludes `returned` and `cancelled`, so reusing it would drop the FULL order from revenue on top of subtracting the refund — double-counting the reduction. `refunded` passes through so the reduced total still counts.

> `refunded_amount` is the re-import guard. A sale that already has one is a no-op. Consequence: a second, separate refund against the same order is skipped rather than accumulated.

- [ ] **Step 3: Ask the user to run the full gates and apply the migration**

```bash
npx tsc --noEmit && npm run lint && npx jest && uv run .claude/verifiers/verify_changes.py
```

Also remind them that `031_sales_refunded_amount.sql` and the updated `005_tenant_provisioning.sql` both need applying to Project B — the agent cannot, the MCP servers are read-only.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(sales): document the SALE/REFUND import routing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Known limitations, carried from the spec

- **One refund per order.** A second refund against the same sale is skipped, because `refunded_amount` is the idempotency marker. Amazon's refunds in this report are effectively full.
- **Refunds only match SKU-linked sales.** Integrations-synced orders carry `product_id: null` by design, so in a sync-using tenant no refund will ever match.
- **No transaction around the refund loop.** A mid-loop failure leaves earlier refunds applied. They are guarded by `refunded_amount`, so a retry is a no-op for those rows.
