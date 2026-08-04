# Inventory batch fields + weighted-average cost

**Date:** 2026-08-03
**Status:** Draft — design presented, **not yet approved by user**. Session was
paused here to switch to an unrelated task. Resume by re-reading this file and
confirming sections 3–6 before writing an implementation plan.

## Problem

A user asked for 14 new fields on the Inventory section. Taken literally that is
a large expansion of the `products` table. The question this design answers is:
how many of those 14 already exist, how many belong on **Purchases** rather than
Inventory, and what is the minimum safe change that satisfies the request?

## Key insight

**A "batch" already exists in the system — it is a `purchases` row.** A purchase
records one procurement event of one product, with a quantity and a unit price.
That is a batch. Confirmed with the user: a batch is one SKU's procurement lot,
not a multi-SKU shipment.

This collapses most of the request. Batch-scoped attributes go on `purchases`;
catalog-scoped attributes go on `products`. No new tables, no new pages.

## Requirement mapping

| # | Requirement | Verdict | Location |
|---|---|---|---|
| 2 | Batch Cost | **Already exists** | `Purchase.total_amount` (generated: qty × unit_price) |
| 3 | SKU | **Already exists** | `Product.sku` |
| 4 | Quantity | **Already exists** | `Purchase.quantity` + `Product.current_stock` |
| 5 | Low Stock Alert | **Already exists** | `Product.reorder_threshold` — may not be *surfaced* in UI |
| 6 | Cost Price | **Already exists** | `Purchase.unit_price` |
| 1 | Batch Name | New column | `purchases.batch_name` |
| 7 | Investor Name | New column | `purchases.investor_name` |
| 11 | Fulfillment Center | New column | `purchases.fulfillment_center` |
| 12 | Fulfillment Charges | New column | `purchases.fulfillment_charge` |
| 13 | Shipping Type | New column | `purchases.shipping_type` |
| 8 | Price for Resellers | New column | `products.reseller_price` |
| 9 | Product Image Link | New column | `products.image_url` |
| 10 | Product Specifications | New column | `products.specifications` |
| 14 | Avg / FIFO costing | Derived view | `{{schema}}.product_costs` |

Five of fourteen require no work at all.

**Requirement 7 is not `vendor`.** `purchases.vendor` already exists and means
*who you bought from*. An investor is *who funded the batch* — a distinct
concept. Stored as free text for now; if the user later wants "investor X's
outstanding capital", this needs to become a real reference, not a label.

**Requirement 8 is notable:** `products` currently has no price field at all.
Selling prices live only on individual `sales` rows. Adding `reseller_price`
gives the products table a pricing responsibility it did not previously have.

**Requirement 5 is likely a display gap, not a missing field.** Confirm whether
`reorder_threshold` is visible anywhere on the Inventory page before treating
this as done.

## Decisions taken

### Costing method: weighted average only (req 14)

The requirement as written contains two rules that produce different numbers:

> Batch 1: 100 units @ €10. Batch 2: 100 units @ €12. Sell 100 units.
> - "average price is considered" → remaining units valued at **€11**
> - "when batch 1 ends, batch 2 cost applies" → remaining units valued at **€12**

The first is weighted average; the second is FIFO. **User chose weighted
average.** FIFO is explicitly out of scope.

This matters enormously for cost. Weighted average is derivable from data
already stored — no changes to sales, no changes to stock triggers, no batch
consumption ledger. FIFO would have required a `remaining_quantity` per batch,
oldest-first depletion on every sale, a rewrite of the stock triggers in
`002_inventory_and_vat.sql`, and answers for returns with `restock: true`,
edited sales, and deletion of partially-consumed purchases.

**Consequence to communicate to the end user:** avg cost is the cost of
*everything ever purchased*, not the cost of *current stock*. The "batch 1 is
finished, switch to batch 2" behaviour does not happen under this model.

### Fulfillment charges are recorded, not capitalised (req 12)

`fulfillment_charge` is stored on the batch but **does not feed unit cost**. The
weighted average stays purely `unit_price`-based.

Rationale: `purchases.total_amount` is a **generated column**
(`quantity × unit_price`). Folding fulfillment charges into cost would change
what that column means, which ripples into the Purchases page Gross/VAT/Net
summary cards, invoice generation, and the planner's margin maths. The user
directed that fields which create problems be discarded, so this is recorded
for reporting only.

### Specifications are free text, not a structured tab (req 10)

The requirement said "Specifications Tab", implying a key/value editor with
add/remove rows and its own UI surface. For v1 that is substantial interface for
unproven value. A single multiline text field carries the same information at a
fraction of the cost and can be migrated to structured data later.

### Average cost comes from a read-only DB view

Chosen over a trigger-maintained column (which would mean modifying
`apply_purchase_stock_change`, the riskiest code in the schema, and could drift)
and over app-layer computation (which needs purchase rows loaded, awkward under
server-side pagination).

## Data model

```sql
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.purchases
    ADD COLUMN IF NOT EXISTS batch_name         text,
    ADD COLUMN IF NOT EXISTS investor_name      text,
    ADD COLUMN IF NOT EXISTS fulfillment_center text,
    ADD COLUMN IF NOT EXISTS fulfillment_charge numeric(12,2) CHECK (fulfillment_charge >= 0),
    ADD COLUMN IF NOT EXISTS shipping_type      text;

  ALTER TABLE {{schema}}.products
    ADD COLUMN IF NOT EXISTS reseller_price numeric(12,2) CHECK (reseller_price >= 0),
    ADD COLUMN IF NOT EXISTS image_url      text,
    ADD COLUMN IF NOT EXISTS specifications text;
$$);
```

All columns nullable and additive. No existing column changes type or meaning.

Per AGENTS.md's **2-places rule**, `provision_tenant_schema()` in
`005_tenant_provisioning.sql` must receive the same columns, or newly
provisioned tenants are born without them.

`Purchase` and `Product` in `src/types/index.ts` gain the matching optional
fields — that file is the single source of truth for domain types.

## The `product_costs` view

```sql
CREATE OR REPLACE VIEW {{schema}}.product_costs
WITH (security_invoker = true) AS
SELECT
  pu.product_id,
  pu.currency,
  SUM(pu.quantity)                 AS total_quantity,
  SUM(pu.quantity * pu.unit_price) AS total_cost,
  SUM(pu.quantity * pu.unit_price)
    / NULLIF(SUM(pu.quantity), 0)  AS avg_unit_cost
FROM {{schema}}.purchases pu
WHERE pu.product_id IS NOT NULL
GROUP BY pu.product_id, pu.currency;
```

### `security_invoker = true` is mandatory

Without it, a Postgres view executes with the privileges of its **owner**, which
silently bypasses the RLS policies on `purchases`. In a multi-tenant schema that
is a cross-tenant data leak, not a bug. This is the single most important line
in the migration. The view also needs `GRANT SELECT` to `authenticated`,
matching the grants the sibling tables receive.

### Currency forced a grouping decision

`purchases.currency` exists, so a product bought in both EUR and USD has no
single meaningful average — blending them produces a number that is simply
wrong. The view therefore groups by `(product_id, currency)` and returns one row
per product per currency.

A pure helper, `src/app/dashboard/inventory/_lib/productCost.ts`, selects which
row to display: prefer the row matching the tenant's default currency (from
`companyProfileSlice`), otherwise fall back to the row with the highest
`total_quantity`. Keeping this in `_lib/` is what makes the multi-currency edge
case unit-testable without rendering the page.

## UI changes

**`AddPurchaseModal` / `EditPurchaseModal`** — five new inputs under a "Batch
details" heading, so the existing product/quantity/price fields stay visually
primary. `EditPurchaseModal` already requires a reason-for-edit and records a
before/after diff in audit metadata; new fields must join that same diff shape.

**`AddProductModal` / `EditProductModal`** — three new inputs. `specifications`
is a `<textarea>`; `image_url` is a plain text input. `EditProductModal` has the
same reason-for-edit + diff requirement.

**Inventory `page.tsx`** — new "Avg. Cost" column sourced from the view, and an
image thumbnail where `image_url` is set. Also surface `reorder_threshold` as a
visible low-stock indicator (see requirement 5 above).

**CSV import/export — unchanged in v1.** The purchases export currently ships a
fixed 10-column list; adding five more changes a file format the user may have
downstream consumers for. Deferred until the fields prove useful. *This was the
last open question put to the user and was not explicitly answered — confirm on
resume.*

## Testing

Per the working agreement in AGENTS.md: no dev server, no `curl`, and the agent
does not run `npm test` / `tsc` / `lint` mid-task — the user runs them and
pastes output.

- Extend `purchases/_store/purchasesSlice.test.ts` and
  `inventory/_store/inventorySlice.test.ts` for the new fields.
- New `inventory/_lib/productCost.test.ts` covering: single currency; the
  multi-currency tie-break; the zero-quantity divide guard (`NULLIF`); and the
  no-purchases-yet null case.

## Out of scope

- FIFO / batch depletion tracking
- Capitalising fulfillment charges into unit cost
- Structured key/value specifications editor
- Multi-SKU shipment batches (a batch is one SKU)
- CSV format changes
- Investor as a first-class entity with capital tracking

## Docs to update in the same commit

AGENTS.md requires this, not as a follow-up:

- `src/app/dashboard/purchases/CLAUDE.md` — file map + the new batch fields
- `src/app/dashboard/purchases/SKILL.md` — gotcha entry for the fields
- `src/app/dashboard/inventory/CLAUDE.md` — file map (new `_lib/`), the view,
  and the currency-selection rule
- `src/app/dashboard/inventory/SKILL.md` — `security_invoker` gotcha, the
  "avg cost ≠ cost of current stock" gotcha
- `supabase/SKILL.md` — the new migration in the file-map/apply-status table

## Open items on resume

1. Design has **not** been approved by the user — confirm before planning.
2. CSV export question was never answered (see UI section).
3. Confirm whether `reorder_threshold` is already visible on the Inventory page.
4. Unrelated: a doc-drift review in `.claude/claude-md-review.md` was assessed
   this session — item 1 (root `CLAUDE.md` does not point to `.claude/README.md`,
   and documents only 1 of the 3 registered Stop hooks) is **valid and
   unfixed**; items 2, 3 and 4 were verified against `.claude/settings.json` and
   are **incorrect — dismiss them**. `refresh_graphify.py` is still directly
   registered as a Stop hook.
