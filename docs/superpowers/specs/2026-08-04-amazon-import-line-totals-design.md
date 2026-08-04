# Amazon sales import — line totals, shipping, VAT and returns

**Date:** 2026-08-04
**Status:** Design approved by user. Ready for an implementation plan.
**Branch:** `fix/amazon-import-line-totals` (off `main` @ `4ea9b01`)

## Problem

Importing a real Amazon VAT-transactions report fails on the validator at
`src/app/dashboard/sales/_components/importFormats.ts:277`:

```ts
if (Math.abs(quantity * up - totalAmount) > 0.02) {
  return fail(`"total" (${totalAmount}) disagrees with quantity × unit_price (…)`);
}
```

The check assumes `total = quantity × unit_price`. Amazon's report satisfies
neither half of that equation. Diagnosing the failure surfaced five further
defects, one of which imports **silently wrong data**.

## Evidence — from a real April 2026 report

Verified against an actual `Q2-April-2026` export.

**Line totals, not unit prices.** Order `028-4502196-4511533`: `quantity` = 2,
`unit_price` = 16.10, `total` = 16.10. The column mapped to `unit_price` is
Amazon's `TOTAL_PRICE_OF_ITEMS_AMT_VAT_INCL` — the whole line. Amazon's report
has **no per-unit price column at all**. The validator computes 2 × 16.10 =
32.20 and fails. This breaks every `quantity > 1` row regardless of shipping.

**Total includes shipping.** Order `028-7135526-5060303`: items 7.99 +
shipping 2.00 = total 9.99. Fails even at quantity 1.

**VAT rate is a fraction.** Amazon writes `0.19`. The validator accepts
`0 <= x <= 100`, so `0.19` passes and is stored as **0.19 %** instead of 19 %.
This is the worst defect here: it does not error, it imports wrong.

**VAT on shipping is a separate component.** Same order: item VAT 1.28 +
shipping VAT 0.32 = 1.60 total. Rates can differ per component — the Swedish
rows carry 25 %.

**Unsupported currency.** `Currency` is `EUR | USD | GBP`; the report contains
`amazon.se` orders in SEK.

**Most rows are not sales.** The file also contains `RETURN` rows (every amount
blank), `REFUND` rows with **negative** totals (rejected by `"total" must be a
positive number`), `FC_TRANSFER` warehouse movements with no prices, dozens of
blank filler rows, and a trailing `Total,,,,…` summary row.

## Structural constraint discovered

`Sale` in `src/types/index.ts` has **no `sku` field**. It stores
`external_order_id` and `product_id`. The report contains multi-line orders that
share one order id — `028-6107376-1547566` appears twice, once for
`100-CNC-3842-5P` and once for `K2T-PFM-024`. Therefore matching a RETURN on
`external_order_id` alone is ambiguous; it must match on **order id + the
product resolved from the SKU**.

## Column semantics for the `amazon` format

The format declares what its columns mean rather than inheriting generic
assumptions.

| Sheet column | Amazon field | Handling |
|---|---|---|
| `unit_price` | `TOTAL_PRICE_OF_ITEMS_AMT_VAT_INCL` | **line** total → derive per-unit = `item_total / quantity` |
| `shipping_charged` | `TOTAL_SHIP_CHARGE_AMT_VAT_INCL` | stored as-is |
| `total` | `TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL` | validate `total ≈ item_total + shipping_charged` |
| `vat_rate` | `PRICE_OF_ITEMS_VAT_RATE_PERCENT` | fraction → ×100 via a per-format flag |
| `vat_amount` | `TOTAL_ACTIVITY_VALUE_VAT_AMT` | **new mapping** — combined item + shipping VAT |

**Why `vat_amount` is mapped explicitly rather than derived.** Amazon already
provides the combined figure. Deriving it from a single rate is wrong whenever
the shipping VAT rate differs from the item rate, which it does on the Swedish
rows. Taking Amazon's own number avoids reconstructing a figure it already
computed.

**The validation replaces, not supplements, the old one.** The
`quantity × unit_price` identity is simply false for this format and must not be
applied to it. The `generic` format keeps its existing check unchanged.

### What is actually persisted — critical, easy to get wrong

`src/app/dashboard/_lib/aggregateSales.ts:25` computes
`revenue = total_amount + shipping_charged`. So **`total_amount` must hold the
ITEM line total only**, never the sheet's `total` column. Storing 9.99 into
`total_amount` while also storing `shipping_charged = 2.00` would report 11.99
revenue for a 9.99 order.

For order `028-7135526-5060303`:

| Field | Value | Source |
|---|---|---|
| `unit_price` | 7.99 | derived: `item_total / quantity` |
| `total_amount` | 7.99 | the item line total |
| `shipping_charged` | 2.00 | Amazon's total ship charge, VAT incl |
| `vat_amount` | 1.60 | Amazon's combined item + shipping VAT |
| `vat_rate` | 19 | `0.19 × 100` |

The sheet's `total` column (9.99) is used **only** to validate that
`total ≈ total_amount + shipping_charged`. It is never written to the database.

**Why the combined VAT figure is consistent here.** `vat_amount` = 1.60 is the
VAT on the full 9.99, which is exactly the revenue figure `aggregateSales`
produces — 9.99 × 0.19/1.19 = 1.595 ≈ 1.60. It is not inconsistent with a
`total_amount` of 7.99; it is VAT on revenue, not VAT on `total_amount`.
Confirmed against the Swedish row `406-4012512-5663517`: 73.99 × 0.25/1.25 =
14.80, matching Amazon's `TOTAL_ACTIVITY_VALUE_VAT_AMT` exactly.

**Note:** `sales.total_amount` and `purchases.total_amount` are plain writable
`numeric(12,2) NOT NULL` columns — verified live, `is_generated = NEVER`.
`src/app/dashboard/purchases/CLAUDE.md` incorrectly describes `total_amount` as
"(generated column)". That doc error should be corrected, and any reasoning that
depended on it revisited.

## Row routing by the `status` column

| Status | Action |
|---|---|
| `SALE` | insert a sale |
| `RETURN` | match an existing sale and flip its status (see below) |
| `REFUND` | **skip**, counted |
| `FC_TRANSFER` | **skip**, counted |
| blank filler rows | **skip**, not counted as errors |
| trailing `Total` summary row | **skip** |
| any row whose currency is not `EUR`/`USD`/`GBP` | **skip**, counted and surfaced |

## RETURN handling

1. Resolve the row's SKU to a product.
2. Look for a sale with matching `platform`, `external_order_id` **and** that
   product.
3. **Matched** → set `status = 'returned'`, apply the per-import restock choice,
   dispatch `updateSale` so the Orders page reflects it without a refetch, and
   write a per-sale audit entry.
4. **Unmatched** → **skip the row**, reported as `return: no matching order`
   through the Task 6 skip-reason UI. Nothing is inserted.

**RETURN rows must be exempted from the duplicate pre-check** — both the
in-file pass and the database pass. They carry an `external_order_id` by
definition, so without a carve-out every return whose original sale exists is
marked "order already exists" and dropped before matching can run, making the
entire feature unreachable.

### Superseded decision — standalone returned rows (2026-08-04)

The original design inserted a standalone `returned` sale when a return could
not be matched. **That is not implementable.** `idx_sales_platform_external_order_id`
is a NON-partial unique index on `(platform, external_order_id)`, verified live
in all five tenant schemas. A standalone row for an order id that already exists
raises a unique violation, fails the whole batch, and surfaces the raw Postgres
error to the user. It would fire whenever a return's SKU is not in inventory, or
when a multi-line order has two unmatched lines.

Rejected alternatives: making the index partial (needs a migration on five live
tenants and weakens the dedup guarantee that prevents double-importing orders),
and falling back to matching on order id alone (flips an arbitrary line of a
multi-line order — the exact ambiguity `product_id` was added to prevent).

Skipping is strictly better than the original design here: nothing is lost,
because the skip is reported with its reason rather than silently dropped.

**Unmatched returns must NEVER restock, regardless of the per-import toggle.**
This is a deliberate carve-out. An unmatched return has no corresponding sale in
the system, so restocking it would create inventory out of nothing — stock for
goods the system never recorded selling. The toggle applies only to returns that
matched a real sale. (User decision, 2026-08-04: revisit later if standalone
rows prove to need it.)

**Known consequence, accepted by the user:** standalone returned rows carry no
price data. Revenue is unaffected because the amounts are zero, but order counts
will include rows that were never recorded as sales. The alternative — blocking
the import — was rejected because the April file legitimately contains returns
for orders placed in March.

## Partial-success reporting — new behaviour

The importer is currently all-or-nothing: every row must be valid or nothing
imports. "Skip with a warning" cannot work under that model, so
`ImportSalesModal` needs to report what was skipped and why.

Without this, dropping the SEK rows silently is precisely the failure mode this
whole change exists to prevent. At minimum: a count per skip reason (non-sale
status, unsupported currency, blank row) shown before the user confirms.

## Per-import restock toggle

A single control in the import modal, applied to every **matched** return in the
file. Amazon's report does not say whether returned goods are resellable, so
this cannot be derived per row.

## Out of scope

- Adding `SEK` to the `Currency` type — those rows are skipped for now. This
  means Swedish revenue does not import; it recurs monthly and deserves its own
  task.
- Importing `REFUND` rows as negative sales.
- `FC_TRANSFER` warehouse movements.
- Adding a `sku` column to `Sale`.
- Restocking standalone returned rows.

## Testing

Per the AGENTS.md working agreement: no dev server, no `curl`, and the agent
does not run `npm test` / `tsc` / `lint` mid-task — the user runs them.

`importFormats.ts` is already pure and has colocated tests, so all of this is
unit-testable without Supabase or Redux. Cases that must be covered, using the
real values from the report:

- quantity 2, line total 16.10, total 16.10 → per-unit 8.05, `total_amount`
  16.10, no error
- items 7.99 + shipping 2.00 = total 9.99 → passes; per-unit 7.99,
  `total_amount` **7.99** (not 9.99), `shipping_charged` 2.00 — a test must pin
  this, because writing 9.99 here double-counts shipping in revenue
- `vat_rate` `0.19` → stored as 19, not 0.19
- `vat_amount` taken from the combined column (1.28 + 0.32 = 1.60), not derived
- `total` disagreeing with `item_total + shipping_charged` beyond 0.02 → error
- SEK row → skipped, counted, not an error
- blank filler row and trailing `Total` row → skipped silently
- `RETURN` matched → status flip, restock follows the toggle
- `RETURN` unmatched → standalone row, restock **false** even when toggle is on
- multi-line order (`028-6107376-1547566`, two SKUs) → return matches the
  correct line, not the first one sharing the order id

## Files affected

- `src/app/dashboard/sales/_components/importFormats.ts` — format flags, amazon
  column semantics, the replaced validation, row routing
- its colocated test file
- `src/app/dashboard/sales/_components/ImportSalesModal.tsx` — restock toggle,
  skipped-row reporting
- `src/app/dashboard/sales/CLAUDE.md` + `SKILL.md` — file map and gotchas

## Decisions taken, with rationale

| Decision | Chosen | Rejected because |
|---|---|---|
| Unit price | Derive from line total | Amazon has no per-unit column |
| Total validation | `item_total + shipping_charged` | The `qty × unit_price` identity is false here |
| VAT rate | Per-format fraction flag | Auto-detecting `< 1` silently breaks a genuine 0.5 % rate |
| VAT amount | Map Amazon's combined figure | Deriving is wrong when shipping VAT rate differs |
| Non-sale rows | Skip, counted | — |
| Unmatched returns | Standalone returned row | Blocking rejects legitimate cross-period files |
| Unmatched restock | Always false | Would create stock from nothing |
| SEK | Skip for now | Adding the currency is a separate, wider change |
| Restock | Per-import toggle | Amazon does not say whether goods are resellable |
