# Amazon import — SALE and REFUND only

**Date:** 2026-08-05
**Status:** Design approved by user. Ready for an implementation plan.
**Branch:** `feat/amazon-refunds` (off `main` @ `90a7734`)

## Problem

The Amazon importer currently treats `RETURN` as the meaningful non-sale event
and skips `REFUND`. That is backwards for how the user reads the report.

- **`REFUND` carries the money.** Its amounts are negative and must be deducted.
- **`RETURN` is logistics noise**, as are `FC_TRANSFER`, blanks and the summary row.
- Rows that are neither `SALE` nor `REFUND` must never error, even when required
  fields like `date` are empty — `RETURN` rows have no `date` at all, which is
  what produced the `Row 21: invalid or missing "date"` failures.

## What this deletes

The return-matching feature built in the `fix/amazon-import-line-totals` branch
is removed: `ParsedRow.isReturn`, the `isReturnRow` parse branch, both
`markDuplicates` carve-outs for returns, the match-and-flip loop, the restock
toggle, and the `returnsMatched`/`returnsSkipped`/`returnsAlreadyApplied`
summary fields. 31 references in `ImportSalesModal.tsx`, 4 in `importFormats.ts`.

The *matching machinery* survives conceptually — it retargets from RETURN to
REFUND and keys the same way.

## Evidence — from the real April 2026 report

A REFUND row, order `304-8612000-9060321`:

```
status = REFUND, order_id = 304-8612000-9060321, sku = K2T-PFM-024
unit_price (TOTAL_PRICE_OF_ITEMS_AMT_VAT_INCL) = -7.99
total      (TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL) = -7.99
vat_amount (TOTAL_ACTIVITY_VALUE_VAT_AMT)      = 0
```

**Every refund in the file shares its order id with its own SALE row**, and both
are in the same file:

| Order | SALE | REFUND | Net |
|---|---|---|---|
| `304-8612000-9060321` | 8.05 on 20 Apr | −7.99 on 28 Apr | 0.06 |
| `303-3977811-8217139` | 6.04 on 14 Apr | −5.99 on 22 Apr | 0.05 |
| `403-2451437-9547510` | 25.99 on 14 Apr | −25.99 on 21 Apr | 0.00 |
| `304-7592975-1775530` | 7.99 on 09 Apr | −7.99 on 18 Apr | 0.00 |

Note the residuals. Refunds are **not always exactly full** — 8.05 refunded
7.99 leaves six cents. Subtracting the actual amount reproduces Amazon's own
net; flipping to a non-revenue status would drop the full 8.05 instead.

## Design

### A refund adjusts its matched sale — it never becomes its own row

Two database constraints make a standalone negative row impossible, both
verified live on `tenant_kaufnest`:

- `sales_unit_price_check CHECK (unit_price >= 0)` — a negative unit price is
  rejected outright.
- `idx_sales_platform_external_order_id` — a NON-partial unique index on
  `(platform, external_order_id)`. Every refund shares its order id with its
  own sale, so a second row collides.

(`total_amount` has no check and *can* go negative — but the other two block the
approach regardless.)

So a matched refund updates the sale in place:

```
order 304-8612000-9060321
  before:  total_amount 8.05,  vat_amount 1.28, status "delivered", refunded_amount null
  after:   total_amount 0.06,  vat_amount 1.28, status "refunded",  refunded_amount 7.99
  revenue: 0.06  ← exactly Amazon's net
```

### `refunded` is a NEW status, deliberately not `returned`

`isRevenueSale` (`src/lib/utils/filters.ts:153-155`) excludes only `returned`
and `cancelled`. A new `refunded` status therefore passes through, so the
**reduced** `total_amount` still counts as revenue — which is the point.

Reusing `returned` would have removed the whole 8.05 from revenue on top of
subtracting 7.99, double-counting the reduction. No change to `isRevenueSale`
is needed, and none should be made.

`Badge.tsx` maps status → variant (`returned: "danger"`, `cancelled: "warning"`).
`refunded` needs an entry or it renders without a variant.

### Idempotency: `refunded_amount` guards the re-import

One additive nullable column on `sales`, via `run_on_all_tenant_schemas` plus
the 2-places rule in `provision_tenant_schema()`:

```sql
ALTER TABLE {{schema}}.sales
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) CHECK (refunded_amount >= 0);
```

A matched sale whose `refunded_amount` is already set is a **no-op** — counted
separately and reported, never re-subtracted. Without this, re-importing the
same file would deduct the refund twice.

**Known limitation:** a second, separate refund against the same order is
skipped rather than accumulated. Amazon's refunds in this report are effectively
full, so this is acceptable; a per-refund transaction id would be needed to do
better and that column is not currently mapped.

### Ordering and dedup — two lessons carried over

Both of these were Criticals on the previous branch. They apply identically here
and must not be rediscovered:

1. **The insert runs BEFORE the refund loop.** A SALE and its REFUND appear in
   the same monthly file (all four examples above), so matching first would
   query `sales` before the SALE row exists and drop every refund.
2. **REFUND rows must be exempt from BOTH `markDuplicates` passes.** They carry
   an `external_order_id` by definition, so without a carve-out every refund is
   marked "order already exists" and dropped before matching runs — making the
   feature unreachable.

### Row routing

| Status | Action |
|---|---|
| `SALE` | insert (unchanged) |
| `REFUND` | match and adjust the sale |
| `RETURN` | **skip**, counted |
| `FC_TRANSFER` | **skip**, counted |
| blank / summary row | **skip** |
| unsupported currency | **skip**, counted |

`NON_SALE_STATUSES` inverts: `refund` comes out, `return` goes in.

A skipped row is classified **before** any field validation, so a `RETURN` row
with no `date` is skipped silently rather than erroring.

### Refund parse shape

REFUND amounts are negative, but the amazon price branch requires a positive
item total. Refunds take their own branch and carry **positive magnitudes**:

```ts
/** Amazon REFUND row. Adjusts an existing sale; never inserted. */
isRefund?: boolean;
refund?: { amount: number; vatAmount: number | null };
```

`amount` is `Math.abs` of the refund total, `vatAmount` likewise. Subtracting a
positive is clearer than adding a negative at the call site.

### Unmatched and over-refund

- **Unmatched** (no sale, or SKU not resolvable to a product) → skipped as
  `refund: no matching order`, reported through the existing skip-reason UI.
- **Refund exceeds the sale's `total_amount`** → row error, not a silent
  negative total. Since only one refund is applied per sale, an over-refund
  means the match is wrong or the data is inconsistent.

Matching requires a resolved `product_id`, so refunds against
integrations-synced orders — which carry `product_id: null` by design — will
never match. In a sync-using tenant that is all of them. Documented, not fixed.

## Out of scope

- Accumulating multiple refunds against one order.
- Importing `RETURN` rows in any form.
- Restocking. The restock toggle is deleted with the return machinery; a refund
  says nothing about whether goods came back.
- Partial-refund reporting beyond `refunded_amount`.

## Testing

Per AGENTS.md: no dev server, no `curl`, and the agent does not run
`npm test`/`tsc`/`lint` mid-task.

`importFormats.ts` is pure and has colocated tests. Cases:

- a `REFUND` row parses with `isRefund: true` and `refund.amount === 7.99`
  (positive) from a `-7.99` sheet value
- a `RETURN` row with an empty `date` is **skipped**, not errored — the exact
  `Row 21` failure
- `FC_TRANSFER` still skipped; blanks and the summary row still skipped
- a `SALE` row is unaffected by any of this
- `classifySkip` no longer skips `REFUND`
- the generic and ebay formats skip nothing, as before

The modal has no test file, so the matching, ordering, dedup carve-out and
idempotency guard are verified by review and by the user in a browser.

## Files affected

- `supabase/migrations/031_sales_refunded_amount.sql` (new)
- `supabase/migrations/005_tenant_provisioning.sql` — 2-places rule
- `src/types/index.ts` — `Sale.refunded_amount`
- `src/components/ui/Badge.tsx` — `refunded` variant
- `src/app/dashboard/sales/_components/importFormats.ts` + test
- `src/app/dashboard/sales/_components/ImportSalesModal.tsx`
- `src/app/dashboard/sales/page.tsx` — summary toast
- `src/app/dashboard/sales/CLAUDE.md` + `SKILL.md`, `supabase/SKILL.md` + `CLAUDE.md`

## Decisions taken

| Decision | Chosen | Rejected because |
|---|---|---|
| Which statuses matter | SALE + REFUND | RETURN is logistics; the money is on REFUND |
| Refund representation | Adjust the matched sale | `unit_price >= 0` and the unique index both block a standalone row |
| Status after refund | New `refunded` | `returned` is excluded by `isRevenueSale`, double-counting the reduction |
| Idempotency | `refunded_amount` column + guard | No marker otherwise; re-import silently deducts twice |
| Non-SALE/REFUND rows | Skipped before validation | They legitimately have no `date` |
| Over-refund | Row error | A silent negative total hides a bad match |
