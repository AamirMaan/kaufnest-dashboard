# Sales feature

Route: `/dashboard/sales`. UI label is **"Orders"** (Sidebar, page title) —
internals (table `sales`, route, `Sale` type, `salesSlice`) keep the "sales"
name. Lists sales records (per platform: Amazon, eBay, Etsy, Shopify, other),
each with an order **status**, with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: server-side pagination (`fetchSalesPage` thunk),
  `FilterBar` (date preset, currency, platform, status, general keyword
  search across product name/order ID/description), row selection, invoice
  trigger, Gross/VAT/Net summary **(this page)**, **Export CSV** button
  (server-side query, no `.range()`, capped at 5 000 rows), **Import CSV**
  button, wires up the modals below. Product-name cells are `<Link>`s to
  `/dashboard/sales/[id]`.
- `[id]/page.tsx` — order-detail page (Client Component). Reads the sale from
  Redux first (`state.sales.items.find`); on direct-URL hit fetches from Supabase
  via `createTenantClient` and dispatches `addSale` to hydrate Redux. Displays
  Financials card (qty/price/totals/fees/net proceeds + Cost of Goods and Gross
  Profit rows when a linked purchase exists) and Details card (description/linked
  product/restock flag/audit fields). Linked purchase is resolved from
  `state.purchases.items` (fast path) or a second Supabase effect that queries
  `purchases` with `.maybeSingle()` and dispatches `addPurchase` on hit. Gross
  profit computed via `computeGrossProfit(netProceeds, linkedPurchase)` from
  `_components/orderMath.ts`; Gross Profit row renders red/green by sign, Cost of
  Goods row always red; both hidden when no purchase is linked. Actions: Edit Order
  (opens `EditSaleModal`), Download Invoice (calls `generateOrderInvoice(sale,
  companyProfile)` from `lib/utils/generateInvoice` — `companyProfile` from
  `state.companyProfile.profile`; button transiently disabled until profile
  hydrates), Delete (super_admin OR a user granted the `delete_sale`
  permission override, same gate as list page, navigates back to
  `/dashboard/sales` after delete). Net proceeds computed via
  `_components/orderMath.ts`.
- `_store/salesSlice.ts` — Redux slice for `state.sales` (`items`, `loaded`,
  `page`, `pageSize`, `total`, `isFetching`).
  Actions: `hydratePage` (also exported as `hydrateSales` for `StoreProvider`),
  `addSale`, `updateSale`, `removeSale`, `setFetching`.
  Thunk: `fetchSalesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, platform, currency, status, and a keyword
  `search` matched via `.or()`/`ilike` across `product_name`/
  `external_order_id`/`description`, sanitized with `sanitizeIlikeSearchTerm`),
  `.select("*", { count: "exact" })`, `.order("date")`, and `.range(from, to)`
  from `rangeFor()`. Dispatches `hydratePage` on success.
  Used **only** by this feature — registered centrally in `src/store/store.ts`
  and hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/salesSlice.test.ts` — reducer tests (covers `hydratePage`, `setFetching`,
  `addSale`/`removeSale` total arithmetic). Run with `npx jest dashboard/sales`.
- `_components/orderMath.ts` (+ colocated `.test.ts`) — pure `computeNetProceeds(sale)`
  helper: `total_amount + shipping_charged − shipping_cost − advertising_fee` (nulls
  treated as zero). Used by `[id]/page.tsx`. 4 unit tests.
- `_components/AddSaleModal.tsx` / `EditSaleModal.tsx` — create/edit forms.
- `_components/ImportSalesModal.tsx` — bulk CSV import with a **format dropdown**
  (Generic / Amazon sheet / eBay sheet): parses + validates a user-uploaded CSV
  (German-tolerant — see "CSV import/export" below), runs a duplicate pre-check
  on `external_order_id`, shows per-row errors/skips grouped by reason,
  matches Amazon RETURN rows against existing sales and flips their status
  (see "Amazon RETURN rows" below), batch-inserts the remaining importable
  rows via Supabase, dispatches `addSale`/`updateSale` accordingly, writes
  audit log entries (one per matched return + one for the insert batch), and
  reports the outcome via an `ImportSummary` passed to `onSuccess` — `page.tsx`
  turns that into a single toast (`inserted` / `returnsMatched` /
  `returnsSkipped` counts).
- `_components/importFormats.ts` (+ colocated `.test.ts`) — pure import-format
  registry: `IMPORT_FORMATS` (generic/amazon/ebay), header-alias resolution
  (`resolveHeaders`/`canonicalizeRow`), German status synonyms
  (`normalizeStatus` — includes Amazon's `sale` → `delivered`, since Amazon's
  `status` column is a row *type*, not a fulfilment state), skip
  classification for non-sale rows (`classifySkip`/`SkipReason` — amazon
  format only), and per-row validation (`validateRowForFormat`, which also
  parses Amazon RETURN rows into zeroed, `isReturn: true` rows). The `amazon`
  format sets two optional `ImportFormat` flags no other format uses:
  `vatRateIsFraction` (Amazon writes `0.19`, not `19`) and
  `priceColumnsAreLineTotals` (Amazon's `unit_price` column is the item LINE
  total, not a per-unit price — see "Amazon price/VAT semantics" below).
  **All import-format/validation changes go here**, not in the modal.
- `_components/productOptions.ts` (+ colocated `.test.ts`) — pure helpers
  (`selectableProducts`, `productNameFor`) shared by both modals for the
  "Inventory Product" dropdown; see "Inventory link + VAT" below.
- `_components/orderStatus.ts` (+ colocated `.test.ts`) — pure helpers for the
  order-status field: `ORDER_STATUSES` (preset list), `isPresetStatus`,
  `statusLabel`. See "Order status + returns" below.

## Delete gating (super_admin + permission overrides)

`page.tsx` and `[id]/page.tsx` both compute `canDelete = isSuperAdmin ||
hasDeleteOverride`, where `hasDeleteOverride` reads
`s.currentUser.profile?.permission_overrides?.includes("delete_sale")`
directly (NOT via `hasPermission()` from `lib/utils/permissions.ts` — this
file never imports that module, to avoid resurrecting the matrix's
`["super_admin", "admin"]` default for `delete_sale`, which would silently
give ALL admins delete rights they've never had in this UI). Overrides are
granted per-user via the Users feature's Permissions modal
(`src/app/dashboard/users/_components/PermissionsModal.tsx`) and are also
enforced in Postgres RLS (`{{schema}}.current_user_has_override('delete_sale')`
in the `sales_delete` policy, see `supabase/migrations/023_user_permission_overrides.sql`)
— so this isn't just a UI-level gate, the DB backs it too.

## Pagination data flow

Server-side pagination is active. `page.tsx` **does not apply `filterSales`
in memory** — all filtering happens in `fetchSalesPage` (the thunk in
`_store/salesSlice.ts`). The flow for a filter change or page navigation is:

1. User changes a filter or clicks Prev/Next in `<Pagination>`.
2. `page.tsx` dispatches `fetchSalesPage({ page, pageSize, filters })`.
3. The thunk calls `setFetching(true)`, builds a Supabase query with filter
   predicates + `.select("*", { count: "exact" })` + `.range(from, to)`, then
   dispatches `hydratePage({ data, count, page, pageSize })` on success.
4. `state.sales.items` is replaced with the new page; `total` holds the full
   count across all pages; `isFetching` goes back to `false`.
5. The initial hydration (`StoreProvider`) calls `hydratePage` too (aliased as
   `hydrateSales`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.

**Summary cards** show "(this page)" totals only — they are computed from
`state.sales.items` (current page), not all matching rows. This is clearly
labelled in the UI.

**CSV export** (`handleExport`) bypasses Redux and runs a fresh Supabase query
with the same filter predicates but **no `.range()`**, capped at 5 000 rows, so
the export always covers all matching records regardless of which page is shown.

**DataTable sorting** sorts within the current page only (v1 behaviour) — noted
in SKILL.md gotchas.

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
  Both stay `null` when the toggle is off — `total_amount` (a plain writable
  `numeric(12,2) NOT NULL` column, not a generated one — verified live)
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
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Expenses,
  Purchases (don't fork these; extend them if you need new shared behavior —
  `DeleteConfirmModal` also grew optional `confirmLabel`/`confirmingLabel`/
  `reasonLabel`/`reasonPlaceholder` props for the Users feature's Deactivate
  confirmation, all defaulting to the original "Delete" wording)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `app/dashboard/inventory/_store/inventorySlice` — read-only here, for the
  product-link `Select` (`s.inventory.items`)
- `app/dashboard/purchases/_store/purchasesSlice` — `addPurchase` action imported
  by `[id]/page.tsx` to hydrate Redux when the linked purchase is fetched on
  direct-URL load; `state.purchases.items` is also read for the fast path
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv}`, `store/slices/companyProfileSlice`
  (`generateInvoice` also exports `InvoiceOptions` — import from there when passing custom fields to generate functions)
- `types` (`Sale`, `Platform`, `Currency`, `Product`)

## Fee fields (`shipping_cost`, `shipping_charged`, `advertising_fee`)

All three are `number | null` on `Sale`. They surface in:
- `AddSaleModal` / `EditSaleModal` — collapsible "Fees & shipping (optional)" section
  (state-controlled `showFees` boolean + chevron toggle). Empty string → `null`, never `0`.
  `EditSaleModal` auto-opens the section when the existing sale has at least one fee set.
  Fee changes are included in the before/after audit-log diff alongside all other fields.
- `ImportSalesModal` — optional CSV columns `shipping_cost`, `shipping_charged`,
  `advertising_fee` in every import format. Blank/missing → `null`. Non-numeric or
  negative → row error. Validated in `validateRowForFormat()`
  (`_components/importFormats.ts`). Tests in `ImportSalesModal.test.ts` +
  `importFormats.test.ts`.
- `page.tsx` — exported in `handleExport()`; computed "Fees" column in the table
  (value: `shipping_cost + advertising_fee`, displays `—` when both are `null`).

## Linked Purchase (cost of goods)

A sale can be linked to at most one `purchases` row via `purchases.sale_id`. The link is created in three places:
- **AddSaleModal** — collapsible "Purchase cost (optional)" section: creates a purchase alongside the sale in a single submit action.
- **EditSaleModal** — shows a read-only chip when a purchase is already linked ("View →" to `/dashboard/purchases`); shows the same collapsible add-form when no purchase is linked yet.
- **Import review page** — Purchase Cost + Vendor columns; linked purchase created per order when the user confirms the import.

**Order detail page** (`[id]/page.tsx`): linked purchase is looked up from `state.purchases.items.find(p => p.sale_id === saleId)`; falls back to a `purchases.select("*").eq("sale_id", saleId).maybeSingle()` Supabase call on direct-URL loads (result dispatched to `addPurchase` to hydrate Redux). When found, the Financials card renders Cost of Goods and Gross Profit rows; both are hidden when no purchase is linked.

**Math:** `computeGrossProfit(netProceeds, linkedPurchase)` in `_components/orderMath.ts` returns `null` when `linkedPurchase` is `null`; the Gross Profit row is only rendered when the return value is non-null.

## CSV import/export

**Export**: `handleExport()` in `page.tsx` maps `filtered` (current filter state)
to rows and calls `exportToCsv(filename, headers, rows)` from `lib/utils/csv`.
Exported columns: `date, product_name, platform, quantity, unit_price, total_amount,
currency, vat_rate, vat_amount, status, description, shipping_cost, shipping_charged,
advertising_fee`. Export button is disabled when no rows match the filter.

**Import** (`ImportSalesModal` + `importFormats.ts`): the modal has a
**format dropdown** with three formats defined in the pure registry
`_components/importFormats.ts`:

| Format | Required columns | Platform | Notes |
|---|---|---|---|
| `generic` | `date, product_name, quantity, unit_price` | per-row `platform` column (default `other`) | the original template; now also accepts optional `total` and `order_id` |
| `amazon` | `order_id, date, product_name, quantity, total` | forced `amazon` | `order_id` → `external_order_id`; `unit_price`/`vat_rate` are semantically different from the other two formats — see "Amazon price/VAT semantics" below |
| `ebay` | same as amazon | forced `ebay` | `advertising_fee` = Promoted Listings fee |

Optional in all formats: `unit_price`/`total` (see rule below for
generic/ebay — amazon has its own rule, below), `currency` (default EUR),
`vat_rate` (0–100 for generic/ebay; amazon writes fractions, see below),
`status` (German synonyms normalized via `normalizeStatus` —
`versandt`→`shipped`, `storniert`→`cancelled`, Amazon's `sale`→`delivered`,
etc.; other custom strings pass through; default `"pending"`), `description`,
`shipping_cost`, `shipping_charged`, `advertising_fee` (blank → `null`,
non-numeric or negative → row error), **`sku`** (German aliases: `artikel-nr`,
`artikelnr`, `artikelnummer`; blank/absent → no link). When `sku` matches a
product in the hydrated Redux inventory (`state.inventory.items`), the modal
sets `product_id` on the inserted row, triggering the `sales_stock_change` DB
trigger to decrement stock automatically. The match is case-insensitive.
`ParsedRow.sku` carries the raw SKU string out of `validateRowForFormat`;
`product_id` is resolved in `ImportSalesModal.handleImport` using a
`Map<string, string>` built from `inventoryItems` — resolution is intentionally
deferred to the modal so `importFormats.ts` stays pure and testable.

**German tolerance (all formats):** delimiter auto-detect (`,`/`;`/tab —
`lib/utils/csv.ts → detectDelimiter`), BOM strip, decimal commas and thousands
dots (`"1.234,56"` — `lib/utils/localeParse.ts → parseLocaleNumber`), dates in
`YYYY-MM-DD` or `DD.MM.YYYY` (`parseFlexibleDate`; two-digit years rejected),
German **header aliases** (`Datum`, `Artikelname`, `Menge`, `Preis`, `MwSt`,
`Bestellnummer`, … — the `ALIASES` map in `importFormats.ts`). Files that fail
UTF-8 decoding are re-read as `windows-1252` (German Excel default). Unknown
columns are ignored; missing required columns are a file-level error.

**`total` vs `unit_price` rule (I4, generic/ebay only):** if `total` is
present it wins — `total_amount = total`, and `unit_price` is derived
(`round(total/qty, 2)`) when blank. If both are present and `qty ×
unit_price` differs from `total` by more than 0.02 → row error. If only
`unit_price` is given, `total_amount = qty × unit_price` as before.

**Amazon price/VAT semantics (`priceColumnsAreLineTotals` /
`vatRateIsFraction`, amazon format only):** Amazon's VAT-transactions report
has no per-unit price column — its `unit_price` column is really the item
**line total** (VAT incl.), and its `total` is items + shipping combined.
`validateRowForFormat` derives the item total from `unit_price` when present;
when it's blank, the item total is backed out of the sheet `total` as
`sheetTotal - shippingCharged` (never the raw sheet total — that would be
shipping-inclusive). The row's `unit_price` is then stored as `itemTotal /
quantity`, and `total_amount` stores the **item total only** — the sheet
`total` itself is used only to validate `total ≈ total_amount +
shipping_charged` (when both were supplied) and is otherwise discarded, never
persisted. VAT rates are fractions on Amazon (`0.19`, not `19`) — scaled by
the `vatRateIsFraction` flag before range-checking, never inferred from the
value's magnitude (a genuine 100% rate would falsely trip an `if (rate < 1)`
check). `vat_amount` is itself a mapped column (`ALIASES.vat_amount`) and,
when present in the file, wins over the value `vatAmountFromGross` would
otherwise derive from `vat_rate` — Amazon supplies the combined item+shipping
VAT, which a single-rate derivation gets wrong when shipping's VAT rate
differs from the item's (e.g. the Swedish rows, 25%).

**`classifySkip` (amazon format only):** a real Amazon VAT report is mostly
non-sale rows — blank filler rows, a trailing "Total" summary row (detected
structurally: no `date`/`product_name`/`quantity`), `REFUND`/`FC_TRANSFER`
status rows, and unsupported currencies. These are marked `skipped` with a
reason rather than errored, since validation is all-or-nothing and erroring
on them would make a real export impossible to import. `RETURN` rows are
deliberately NOT skipped here — see "Amazon RETURN rows" below. The format
guard (`if (!format.priceColumnsAreLineTotals) return null`) must stay the
first statement in the function — putting the blank-row check above it would
make `generic` and `ebay` silently skip blank rows instead of erroring them.

**Amazon RETURN rows:** `validateRowForFormat` parses these into a row with
`unit_price`/`total_amount` zeroed (`vat_rate`, `vat_amount`,
`shipping_cost`, `shipping_charged`, and `advertising_fee` are `null`, not
`0`), `status: "returned"`, `restock: false`, and `isReturn: true` — Amazon
leaves every money column blank on a RETURN line.
`ImportSalesModal.handleImport` then tries to match each one to an existing
sale on **platform + `external_order_id` + resolved `product_id`** (from
`sku`) — Amazon order ids are not unique within a sheet, a multi-line order
appears once per SKU, so the product must be part of the match key or the
wrong line gets flipped. A match's `status`/`restock` are updated via
`updateSale` (restock only when the user checked "Return stock to inventory
for matched returns" — a per-import toggle, off by default, that applies only
to matched returns) and a per-sale audit entry is written
(`reason: "bulk import: matched return"`). **Unmatched returns are skipped**
(`skipped: "return: no matching order"`), not inserted standalone — a
non-partial unique index on `(platform, external_order_id)` exists in every
tenant schema (verified live), so inserting a row for an order id that
already exists (or a second unmatched line of an already-matched multi-line
order) would raise a unique violation and fail the whole batch.

**Duplicate pre-check (I3):** rows carrying an `external_order_id` are checked
against existing `sales` rows per `(platform, external_order_id)` (chunked
`.in()` queries, 200 ids per chunk) and against duplicates within the file.
Matches are marked **skipped** and are never overwritten (same protection as
the integrations re-sync merge rule). RETURN rows are exempt from both dedup
passes (file-level and DB-level) — they carry the `external_order_id` of an
*existing* sale by definition, so without the carve-out every return would be
marked "order already exists" and dropped before the matching path above ever
runs. Skips don't block importing the remaining rows; validation errors still
do. The modal groups all skip reasons (duplicate, blank row, summary row, not
a sale, unsupported currency, no matching order, …) via `skipReasonCounts`
and names each one in the summary text — it no longer assumes every skip is
"order already exists".

`product_id` is resolved automatically when the row carries a `sku` that matches
an inventory product (see `sku` above); otherwise it is `null` — user can link
via Edit afterward. `vat_amount` is computed via `vatAmountFromGross`
over `total_amount`, unless the file supplies a `vat_amount` column directly
(amazon/ebay only), which wins. `restock` is always `false` for newly
**inserted** rows (not importable — edit the record afterward to mark it
returned/restockable); a matched Amazon return instead **updates** an
existing sale's `restock` via the per-import toggle (see "Amazon RETURN rows"
above) — that's a different code path, not an inserted row. Audit log: one
entry for the whole batch with `{ bulk_import, count, format, skipped,
returns_matched, returns_unmatched, restock_returns }` (omit `entityId` —
it's `string | undefined`, not nullable), plus one additional per-sale audit
entry for each matched return (`action: "update"`, before/after status/restock
diff).

## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
