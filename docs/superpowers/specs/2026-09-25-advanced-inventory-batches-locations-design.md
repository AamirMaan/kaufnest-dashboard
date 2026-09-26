# Advanced inventory: batches, locations & fulfillment — design

**Date:** 2026-09-25
**Status:** Approved in brainstorming, pending spec review
**Plans:** Business (and `trial`, which mirrors Business in `planGating.ts`). Starter/Pro keep the current simple inventory unchanged.

## Problem

Inventory today is one `products.current_stock` number per product, maintained
by `apply_purchase_stock_change` / `apply_sale_stock_change` triggers. There is
no notion of *where* stock is, and no per-unit cost — an order only gets a cost
of goods if a purchase is manually linked via `purchases.sale_id`.

Business sellers need:

1. **Batches** — each purchase is a batch with its own landed cost (freight,
   customs, etc. differ per batch), so each order gets an accurate COGS.
2. **Locations** — stock held at several places (own premises, Amazon FBA, 3PL,
   dropship supplier).
3. **Fulfillment** — each order records which location shipped it and draws
   stock from there.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Which batch does a sale consume? | **Automatic FIFO** per location, oldest `received_at` first. No manual pick. |
| How is a batch formed? | **One purchase = one batch**, with optional `freight_cost`, `customs_cost`, `other_cost` fields. |
| Stock movement between locations | **Transfers**, FIFO, batch cost travels with units, optional transfer cost added to landed cost. |
| Fulfillment location on orders | **Per-platform default**, editable per order. Synced orders get the default. |
| Insufficient stock at location | **Allow**, stock goes negative (shortfall), UI warns. Never block. |
| Existing data | **Start clean** — opening lot per product at cost 0, no history replay. |
| Plan gating | Business (+ trial) only. |
| Architecture | **Ledger alongside existing `current_stock`, FIFO in Postgres triggers**, gated by a per-tenant flag. |

Out of scope (possible follow-ups): stock adjustments/write-offs, a batch
reporting page, per-location reorder thresholds, shared freight bills split
across several purchases, retroactive history replay.

## Architecture

The existing simple triggers stay **untouched for all plans** —
`products.current_stock` remains the all-locations total, and low-stock
notifications (`synthesizeLowStock`) keep working unchanged.

A new ledger (`stock_lots`, `stock_movements`, …) is maintained by **new**
triggers that are no-ops unless `inventory_settings.advanced_enabled = true`.
FIFO lives in Postgres so every writer — client modals, CSV imports, the
integrations order sync — goes through one code path and cannot drift.

Once enabled, the ledger stays maintained **regardless of plan**. A downgrade
only hides the UI; re-upgrading needs no rebuild.

All DDL uses `public.run_on_all_tenant_schemas($$ … {{schema}} … $$)` and is
mirrored into `provision_tenant_schema()` (`005_tenant_provisioning.sql`), per
the 2-places rule in `supabase/SKILL.md`. New migrations:
`supabase/migrations/047_advanced_inventory.sql` (defines the shared
installer `public.install_advanced_inventory`) and
`048_advanced_inventory_apply.sql` (runs it on every tenant);
`provision_tenant_schema()` calls the same installer.

## Data model

### New tables (per tenant schema)

**`inventory_settings`** — single row.
- `id boolean primary key default true check (id)` (singleton)
- `advanced_enabled boolean not null default false`
- `enabled_at timestamptz`
- `default_location_id uuid null references stock_locations(id)` — fallback
  location for purchases/sales with no explicit location (set to "Main" on
  enable; user-changeable, must be active and non-dropship)

**`stock_locations`**
- `id uuid pk`, `name text not null`, `type text not null check (type in ('own','fba','3pl','dropship'))`
- `is_active boolean not null default true`, `created_by uuid`, `created_at timestamptz`
- Unique `(lower(name))`.
- `type = 'dropship'` → the location never holds stock (see below).

**`platform_location_defaults`**
- `platform text primary key` (same values as `sales.platform`)
- `location_id uuid not null references stock_locations(id)`

**`stock_lots`** — units of one batch at one location.
- `id uuid pk`, `product_id uuid not null references products(id) on delete cascade`
- `location_id uuid not null references stock_locations(id)`
- `purchase_id uuid null references purchases(id)` — null for opening lots and shortfall lots
- `source_lot_id uuid null references stock_lots(id)` — set on lots created by a transfer
- `kind text not null check (kind in ('purchase','opening','transfer','shortfall'))`
- `received_at timestamptz not null` — FIFO key; transfer lots inherit the source's value
- `unit_cost numeric(12,4) not null`
- `qty_received integer not null`, `qty_remaining integer not null`
- Index `(product_id, location_id, received_at)`.
- Invariant: only `kind = 'shortfall'` may have `qty_remaining < 0`; at most one
  shortfall lot per `(product_id, location_id)` (partial unique index).

**`stock_transfers`**
- `id uuid pk`, `product_id`, `from_location_id`, `to_location_id` (check from ≠ to)
- `quantity integer not null check (quantity > 0)`, `transfer_cost numeric(12,2) null`
- `date date not null`, `note text null`, `created_by uuid`, `created_at timestamptz`

**`stock_movements`** — append-only ledger.
- `id uuid pk`, `product_id`, `location_id`, `lot_id uuid null references stock_lots(id)`
- `kind text check (kind in ('receipt','sale','transfer_out','transfer_in','opening'))`
- `qty integer not null` (signed: + in, − out), `unit_cost numeric(12,4) not null`
- `sale_id`, `purchase_id`, `transfer_id` — nullable FKs, exactly the one matching `kind`
- `created_at timestamptz`
- A sale's movements are deleted and re-created on revert-then-reapply (so
  "append-only" applies to receipts/transfers; sale rows are replaced).

### Changed tables

**`purchases`** — add `location_id uuid null references stock_locations(id)`,
`freight_cost`, `customs_cost`, `other_cost` (`numeric(12,2) null`, `>= 0`).

**Landed unit cost** = `((total_amount − coalesce(vat_amount,0)) + freight + customs + other) / quantity`.
VAT is excluded because it is normally reclaimable. This formula lives in the
trigger and is mirrored by `inventory/_lib/landedCost.ts` for the UI read-out.

**`sales`** — add `fulfillment_location_id uuid null references stock_locations(id)`
and `cogs_amount numeric(12,2) null`. `cogs_amount` is written **only** by the
trigger (never from UI code).

**`products`** — unchanged.

### RLS & grants

Same pattern as `products`: authenticated tenant users can `select` all new
tables; `insert/update/delete` on `stock_locations`, `platform_location_defaults`,
`stock_transfers` for authenticated users (UI restricts to admin roles).
`stock_lots`, `stock_movements`, `inventory_settings` are **select-only** to
clients — written only by `SECURITY DEFINER` triggers/functions and the
enable route.

## Trigger behavior

All new trigger functions are `SECURITY DEFINER SET search_path = <schema>` and
return immediately when `advanced_enabled` is false. Each operation locks the
affected `(product_id, location_id)` lot rows with `SELECT … FOR UPDATE` to
serialize concurrent writers (e.g. two synced orders for the same SKU).

A lot "holds stock" only when its location's `type <> 'dropship'`.

### Purchases (`AFTER INSERT/UPDATE/DELETE`)

- **Insert**, `product_id` set, location is stock-holding (null `location_id`
  → `inventory_settings.default_location_id` is filled in by a `BEFORE INSERT`
  trigger): create a `purchase` lot at landed cost + a `receipt` movement.
  If a shortfall lot exists at that `(product, location)`, **settle it first**:
  the receipt fills the negative quantity, the shortfall's `sale` movements are
  re-pointed to the new lot at its `unit_cost`, affected `sales.cogs_amount`
  are recomputed, and the shortfall lot is removed when it reaches 0.
- **Insert** at a dropship location, or without `product_id`: no lot.
- **Update**:
  - cost-only change → recompute lot `unit_cost`; propagate to every lot
    derived from it via transfer (`source_lot_id` chain, keeping each derived
    lot's transfer-cost share), to their `sale` movements, and recompute
    affected `sales.cogs_amount`.
  - quantity change → `consumed = qty_received − qty_remaining` (including
    units transferred out). If new qty ≥ consumed, adjust `qty_received` and
    `qty_remaining`; else raise `INV_CONSUMED`.
  - `product_id` or `location_id` change → allowed only if nothing consumed
    (delete + recreate lot); else raise `INV_CONSUMED`.
- **Delete** → allowed only if nothing consumed; else raise `INV_CONSUMED`.

### Sales (`BEFORE INSERT/UPDATE` + `AFTER INSERT/UPDATE/DELETE`)

- **BEFORE**: if `fulfillment_location_id` is null and `product_id` is set,
  fill from `platform_location_defaults[platform]`, falling back to
  `inventory_settings.default_location_id`.
- **Consumption rule** (same as today's `apply_sale_stock_change`): a sale
  consumes `quantity` units unless `status = 'returned' AND restock`.
- **Insert**: if consuming and location is stock-holding → take FIFO from lots
  at that location (oldest `received_at`, `qty_remaining > 0`), writing one
  `sale` movement per lot touched; remainder goes to the location's shortfall
  lot (created on demand, `unit_cost` = product's most recent lot `unit_cost`
  anywhere, else 0). `cogs_amount = Σ(qty × unit_cost)`.
- Dropship location → no movements; `cogs_amount` stays null (order page falls
  back to the linked purchase, as today).
- **Update** where `product_id`, `fulfillment_location_id`, `quantity` and
  the consumption rule's result are all unchanged → **no ledger change**
  (editing a note or fee never re-costs an order).
- **Update (stock-relevant) / Delete**: revert — restore each of the sale's movements' qty back
  to its lot, delete the movements — then reapply NEW (update only). Covers
  edits to quantity, location, status/restock and product.
- **Pre-enable returns**: rows created before `enabled_at` are otherwise
  ignored. An update to one acts only when the consumption rule's result flips,
  the sale has a product, and its location (own, else platform default, else
  `default_location_id`, resolved in the AFTER trigger) holds stock. Into
  returned + restocked: if the sale has movements (from an earlier un-restock)
  they are reverted and `cogs_amount` set to 0, checked before the
  product/location conditions so it happens wherever the location now
  resolves; otherwise the `OLD.quantity`
  units come back as a new zero-cost `opening` lot (`received_at` 1970) with an
  `opening` movement, settling any shortfall at that location, and
  `cogs_amount` is left alone. Out of it (restock undone): FIFO consumes
  `quantity` at that location and COGS is recomputed. Any other pre-enable edit
  is ignored.
- **Productless sales are ignored**: an update where both OLD and NEW
  `product_id` are null (never had a product, or it was deleted) touches no
  lots and keeps any booked `cogs_amount`.
- `cogs_amount` is recomputed by the AFTER trigger via a direct `UPDATE`
  guarded against recursion (`pg_trigger_depth()` check), so it is correct
  after every write.

### Transfers (`AFTER INSERT/DELETE`; `UPDATE` rejected)

- **Insert**: FIFO-consume `quantity` from source-location lots. For each
  portion taken, write `transfer_out`, create a `transfer` lot at the
  destination with the same `purchase_id` and `received_at`,
  `source_lot_id` = the source lot, `unit_cost = source.unit_cost + transfer_cost / quantity`,
  and a `transfer_in` movement. If the destination has a shortfall lot, settle
  it as for purchases. Insufficient source stock → raise `INV_INSUFFICIENT`
  (unlike sales, a transfer the user just typed can be blocked safely).
  Transfers to or from a dropship location → raise `INV_DROPSHIP_LOCATION`.
- **Update** → raise `INV_TRANSFER_IMMUTABLE` (delete and re-create instead).
- **Delete**: allowed only if every destination lot it created is untouched
  (`qty_remaining = qty_received`); reverses both sides. Else `INV_CONSUMED`.

### Error codes

Triggers raise `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODE>: <detail>'`
with codes `INV_CONSUMED`, `INV_INSUFFICIENT`, `INV_DROPSHIP_LOCATION`,
`INV_TRANSFER_IMMUTABLE`, `INV_LOCATION_IN_USE`. `src/lib/inventory/inventoryErrors.ts`
maps the code prefix to user-facing toast copy; raw messages never reach the UI.

### Locations

- Deleting a location referenced by any lot, sale, purchase, transfer or
  default → `INV_LOCATION_IN_USE` (FKs `on delete restrict` + friendly
  mapping). Users deactivate instead; inactive locations are hidden from
  selects but still render on historic records.
- Changing a location's `type` to/from `dropship` is rejected while it holds
  any lots.

## Enabling

`POST /api/inventory/enable-advanced`, guarded by
`requireAdvancedInventory()` (`src/lib/inventory/authGuard.ts`: authenticated,
role `admin`/`super_admin`, tenant plan has `advancedInventory`). Calls a
`SECURITY DEFINER` function `enable_advanced_inventory()` in the tenant schema
that, in one transaction and idempotently:

1. Creates location "Main" (`type = 'own'`) if none exists.
2. Sets "Main" as default for every platform value in use.
3. Creates one `opening` lot per product with `current_stock > 0` at "Main",
   `unit_cost = 0`, `received_at = now()`, plus `opening` movements.
4. Sets `advanced_enabled = true`, `enabled_at = now()`,
   `default_location_id` = Main.

Opening lot cost can be edited later from the product lots drawer (a guarded
RPC `set_opening_lot_cost(lot_id, unit_cost)` that re-costs dependent sales).

## Plan gating

- `planGating.ts`: add `advancedInventory` to `PlanLimits` — `trial: true`,
  `starter: false`, `pro: false`, `business: true`; export
  `hasAdvancedInventory(plan)`. Extend `planGating` tests.
- UI shows advanced features iff `hasAdvancedInventory(plan) && advanced_enabled`.
- Starter/Pro see today's Inventory page plus a small upsell card.
- Business with the flag off sees an "Enable batches & locations" card
  (admins only) explaining the one-way switch.

## UI

All built from existing atoms/organisms (`DataTable`, `FilterBar`,
`Pagination`, `Modal`, `FormFields`, `DeleteConfirmModal`, `Toast`), following
the Form conventions in `AGENTS.md` (real `<form>`, `required` on controls,
`type="submit" form=…`, `disabled={saving || !isFormValid}`, busy verbs, toast
on success and failure).

### Inventory page (`/dashboard/inventory`, advanced mode)

Tabs: **Products · Locations · Transfers**.

- **Products** — existing paginated table plus per-location on-hand columns
  (first 4 active locations by name + "Other"), total, and weighted average
  unit cost. Per-location quantities come from a paginated RPC
  `inventory_stock_by_location(product_ids uuid[])` called for the current
  page's ids (bounded by page size). Row click → **product lots drawer**
  listing lots oldest-first (source purchase link, location, received date,
  remaining, unit cost, shortfall badge), with opening-lot cost editing.
- **Locations** — CRUD table (name, type, active, on-hand units), and a
  "Default fulfillment location per platform" card.
- **Transfers** — paginated list (`fetchTransfersPage`) + **Transfer stock**
  modal: product, from, to, quantity, optional transfer cost, date, note; live
  preview of lots to be moved and resulting destination unit cost (via
  `fifoPreview.ts` over the source location's lots). Delete via
  `DeleteConfirmModal`.

### Purchases (advanced mode)

Add/Edit modals: **Location** select (active locations, including dropship,
defaulting to `default_location_id`), collapsible **Landed costs** section (Freight, Customs/duty, Other)
with a live landed-unit-cost read-out from `landedCost.ts`.

### Sales (advanced mode)

Add/Edit modals and order detail: **Fulfilled from** select, pre-filled from
the platform default. A non-blocking warning badge shows when the selected
location has fewer units than the order quantity. The order page Financials
card shows **Cost of goods (FIFO)** from `cogs_amount` and Gross profit; for
dropship-location orders (or when `cogs_amount` is null) it falls back to the
existing linked-purchase COGS.

### Audit

`AuditEntity` gains `"stock_location"` and `"stock_transfer"`. Location CRUD,
platform-default changes, transfers, enabling and opening-cost edits all call
`writeAuditLog` + `dispatch(addAuditLog(...))`.

## Code layout

- `supabase/migrations/047_advanced_inventory.sql` (installer), `048_advanced_inventory_apply.sql` (rollout), `005_tenant_provisioning.sql` (calls the installer)
- `supabase/tests/advanced_inventory.test.sql`
- `src/lib/inventory/{authGuard.ts,inventoryErrors.ts}` (server guard; error map is pure/shared)
- `src/app/api/inventory/enable-advanced/route.ts`
- `src/app/dashboard/inventory/_lib/{landedCost.ts,fifoPreview.ts}` + tests
- `src/app/dashboard/inventory/_store/{locationsSlice.ts,transfersSlice.ts}` + tests
- `src/app/dashboard/inventory/_components/{LocationsTab,TransfersTab,TransferStockModal,ProductLotsDrawer,LocationModal,PlatformDefaultsCard,EnableAdvancedCard}.tsx`
- `src/types/index.ts` — `StockLocation`, `StockLot`, `StockTransfer`, `InventorySettings`; new fields on `Purchase`/`Sale`.
- Purchases/Sales modals + `sales/[id]/page.tsx` edits.

## Testing

- **Jest (pure):** `landedCost` (VAT exclusion, extras, zero/rounding),
  `fifoPreview` (single/multi-lot, shortfall, transfer cost share),
  `inventoryErrors` (code → copy, unknown fallback), slice reducers,
  `planGating` flag.
- **SQL:** `supabase/tests/advanced_inventory.test.sql` runs in a transaction that
  is rolled back, against a throwaway schema created by
  `provision_tenant_schema()`, asserting: FIFO split across two lots;
  shortfall then receipt re-costs the sale; sale edit/delete restores lots;
  returned+restock consumes nothing; dropship location writes no movements;
  transfer cost added to destination unit cost; purchase cost edit propagates
  through transfer lots to COGS; `INV_CONSUMED` / `INV_INSUFFICIENT` raised;
  flag off → no ledger writes; `current_stock` totals still match simple
  triggers. Run against the live DB only with explicit user approval.

## Phasing (4 PRs, each shippable)

1. **Schema + triggers** — migration, provisioning mirror, SQL tests, enable
   RPC + route, types. No UI; invisible to users.
2. **Locations + enable flow** — gating flag, Inventory tabs shell, Locations
   tab, platform defaults, enable card.

   Phase 2 status: implemented per
   `docs/superpowers/plans/2026-09-26-advanced-inventory-phase-2-locations-ui.md`.
   The Locations table's per-location on-hand units column moves to Phase 3,
   together with the per-location stock RPC.
3. **Purchases & Sales** — purchase location + landed costs, sale "Fulfilled
   from", FIFO COGS on order page, product lots drawer.
4. **Transfers** — tab, modal, preview.

Each PR updates `CLAUDE.md`/`SKILL.md` for inventory (and purchases/sales where
touched) plus `supabase/SKILL.md`'s migration table in the same commit.

## Risks

- **Trigger complexity** — FIFO + revert/reapply + shortfall settlement is the
  riskiest code; mitigated by the SQL test script covering every path before
  any UI ships (PR 1).
- **Sale revert/reapply churn** — a stock-relevant edit (qty, location,
  product, return/restock) re-runs FIFO and may land on different lots if
  other sales consumed in between, changing that order's COGS. Unrelated-field
  edits skip the ledger entirely. Documented as a gotcha.
- **Integrations sync** writes sales server-side; it gets the platform default
  via the BEFORE trigger with no code change needed.
