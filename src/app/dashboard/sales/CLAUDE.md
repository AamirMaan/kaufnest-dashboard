# Sales feature

Route: `/dashboard/sales`. UI label is **"Orders"** (Sidebar, page title) —
internals (table `sales`, route, `Sale` type, `salesSlice`) keep the "sales"
name. Lists sales records (per platform: Amazon, eBay, Etsy, Shopify, other),
each with an order **status**, with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: filtering (`FilterBar` + `filterSales`), row selection,
  invoice trigger, Gross/VAT/Net summary, **Export CSV** button (exports `filtered`
  via `lib/utils/csv`), **Import CSV** button, wires up the modals below.
- `_store/salesSlice.ts` — Redux slice for `state.sales` (`items`, `loaded`).
  Actions: `hydrateSales`, `addSale`, `updateSale`, `removeSale`. Used **only** by
  this feature — registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/salesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/sales`.
- `_components/AddSaleModal.tsx` / `EditSaleModal.tsx` — create/edit forms.
- `_components/ImportSalesModal.tsx` — bulk CSV import: parses + validates a
  user-uploaded CSV, shows per-row errors, batch-inserts valid rows via Supabase,
  dispatches `addSale` for each, writes one audit log entry for the batch. See
  "CSV import/export" section below.
- `_components/productOptions.ts` (+ colocated `.test.ts`) — pure helpers
  (`selectableProducts`, `productNameFor`) shared by both modals for the
  "Inventory Product" dropdown; see "Inventory link + VAT" below.
- `_components/orderStatus.ts` (+ colocated `.test.ts`) — pure helpers for the
  order-status field: `ORDER_STATUSES` (preset list), `isPresetStatus`,
  `statusLabel`. See "Order status + returns" below.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`await createTenantClient()` from `@/lib/supabase/client`, table `sales`).
2. On success, dispatch the local slice action (`addSale`/`updateSale`/`removeSale`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) to persist an audit row, then dispatch
   `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it immediately in the
   shared audit log state.

`EditSaleModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## Inventory link + VAT (additive fields on `Sale`)

- `product_id: string | null` — optional FK to `products` (Inventory feature).
  Both modals render an "Inventory Product" `Select` sourced from
  `useAppSelector((s) => s.inventory.items)`; selecting one is enough — a DB
  trigger (`sales_stock_change`, see `supabase/migrations/002_inventory_and_vat.sql`)
  decrements `products.current_stock` automatically. **Don't add client-side
  stock math.**
  - The dropdown is filtered via `selectableProducts()` (from the colocated
    `productOptions.ts`) to products with `current_stock > 0` — you can only
    sell what purchases have actually brought in — and shows the stock count
    per option (`"Name — N in stock"`). `EditSaleModal` passes `form.product_id`
    as the second arg so the sale's *currently linked* product stays visible
    even at 0 stock — editing an existing sale never silently drops its link.
  - Picking a product also auto-fills `product_name` via `productNameFor()`
    (see `selectProduct()` in each modal) so the free-text name and the linked
    record can't silently diverge — the user can still hand-edit the name
    afterward if they want a different invoice label.
  - `productOptions.ts` is pure (just filters/looks up over `Product[]`, no
    Supabase/Redux deps) specifically so it's unit-testable without rendering —
    see `productOptions.test.ts`. Extend it (not the modals) if the
    selection/filename rules change.
- `vat_rate`/`vat_amount: number | null` — populated when the user checks
  "Total includes VAT" (a `Checkbox` from `FormFields`). The rate defaults to
  `companyProfile.profile?.vat_rate` (per-tenant default from
  `store/slices/companyProfileSlice`, falls back to `19`) but is editable
  per-record; the amount is extracted from the gross total via
  `vatAmountFromGross` (`lib/utils/currency`).
  Both stay `null` when the toggle is off — `total_amount` (generated column)
  remains the gross/paid figure either way.

## Order status + returns (additive fields on `Sale`)

- `status: string` — defaults to `"pending"`. Both modals render a `Select`
  populated from `ORDER_STATUSES` (`pending`, `processing`, `shipped`,
  `delivered`, `returned`, `cancelled`) plus an `"Other…"` option that reveals
  a free-text "Custom Status" `Input`. `EditSaleModal.saleToForm()` uses
  `isPresetStatus()` to decide whether to show the preset or fall into
  "Other" with the existing custom value prefilled. `page.tsx` renders it via
  `StatusBadge` (`components/ui/Badge.tsx`) and exposes a Status filter
  (`ORDER_STATUSES` ∪ any custom values currently in `sales`, via `statusOptions`).
- `restock: boolean` — only meaningful when `status === "returned"`; both
  modals show a "Item can be resold (restock inventory)" `Checkbox` only in
  that case, and force `restock = false` for every other status before
  writing.
- **Stock trigger** (`apply_sale_stock_change()` — `003_add_order_status.sql`
  for `public`, baked into `provision_tenant_schema()` in
  `005_tenant_provisioning.sql` for `tenant_kaufnest` and every other tenant
  schema): the stock delta for a row is `0` when `status = 'returned' AND restock`
  (net stock effect of the sale cancels out — item goes back to sellable
  stock), otherwise `-quantity` as before (normal sale, or a returned/written-off
  item that can't be resold). **Don't add client-side stock math** — same rule
  as the inventory link below.
- **Revenue/profit exclusion**: any row with `status === "returned"` is
  excluded from the Gross/VAT/Net summary in `page.tsx` (see `summary` useMemo
  — `if (s.status === "returned") continue;`) and from every revenue-derived
  figure on the Overview page (`effectiveSales` in `app/dashboard/page.tsx`).
  `page.tsx` shows a "N returned order(s) excluded from totals" note when
  `returnedCount > 0`. If you add new revenue aggregations in either page,
  apply the same exclusion.

## Platform-synced orders (additive field on `Sale`)

- `external_order_id: string | null` — set only on rows created by the
  Integrations feature (`src/lib/integrations/`, see its `SKILL.md`); always
  `null` for manually-created and CSV-imported rows. A non-partial unique
  index on `(platform, external_order_id)` (Postgres treats multiple `NULL`s
  as distinct, so manual rows never collide) is the dedup key
  `syncPlatformOrders` upserts against — re-syncing the same order updates the
  existing row instead of duplicating it.
- Synced rows always have `product_id: null`, `vat_rate: null`,
  `vat_amount: null`, and `restock: false` — they're never linked to
  inventory or VAT accounting. Both modals and `page.tsx` should treat a
  non-null `external_order_id` as informational only; don't add UI that lets
  a user edit it.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields` (incl. `Checkbox`),
  `DataTable`, `FilterBar`, `Badge` (`PlatformBadge`), `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Expenses and
  Purchases (don't fork these; extend them if you need new shared behavior)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `app/dashboard/inventory/_store/inventorySlice` — read-only here, for the
  product-link `Select` (`s.inventory.items`)
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv}`, `store/slices/companyProfileSlice`
- `types` (`Sale`, `Platform`, `Currency`, `Product`)

## Fee fields (`shipping_cost`, `shipping_charged`, `advertising_fee`)

All three are `number | null` on `Sale`. They surface in:
- `AddSaleModal` / `EditSaleModal` — collapsible "Fees & shipping (optional)" section
  (state-controlled `showFees` boolean + chevron toggle). Empty string → `null`, never `0`.
  `EditSaleModal` auto-opens the section when the existing sale has at least one fee set.
  Fee changes are included in the before/after audit-log diff alongside all other fields.
- `ImportSalesModal` — optional CSV columns `shipping_cost`, `shipping_charged`,
  `advertising_fee`. Blank/missing → `null`. Non-numeric or negative → row error.
  Validated in `validateRow()` (exported for testing). Tests in `ImportSalesModal.test.ts`.
- `page.tsx` — exported in `handleExport()`; computed "Fees" column in the table
  (value: `shipping_cost + advertising_fee`, displays `—` when both are `null`).

## CSV import/export

**Export**: `handleExport()` in `page.tsx` maps `filtered` (current filter state)
to rows and calls `exportToCsv(filename, headers, rows)` from `lib/utils/csv`.
Exported columns: `date, product_name, platform, quantity, unit_price, total_amount,
currency, vat_rate, vat_amount, status, description, shipping_cost, shipping_charged,
advertising_fee`. Export button is disabled when no rows match the filter.

**Import** (`ImportSalesModal`): Required CSV columns: `date` (YYYY-MM-DD),
`product_name`, `platform` (amazon/ebay/etsy/shopify/other), `quantity`, `unit_price`.
Optional: `currency` (default EUR), `vat_rate` (0–100), `status` (defaults to
`"pending"`, no validation against the preset list — custom strings allowed),
`description`, `shipping_cost`, `shipping_charged`, `advertising_fee` (all
`number | null` — blank → `null`, non-numeric or negative → row error).
`product_id` is NOT in the import format — imports create unlinked records; user can
link via Edit afterward. `total_amount` is computed (`qty × unit_price`); `vat_amount`
is computed via `vatAmountFromGross`. `restock` is always `false` for imported rows
(not importable — edit the record afterward to mark it returned/restockable).
All rows must pass validation before import proceeds. Audit log: one entry for the
whole batch (omit `entityId` — it's `string | undefined`, not nullable).

## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
