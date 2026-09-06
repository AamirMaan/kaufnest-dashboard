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
  Also exports `fetchSaleById(saleId)` — a plain async helper (not a thunk)
  that re-reads one `sales` row and returns it or `null`. It exists so
  `EditSaleModal` and `[id]/page.tsx` share one way to reconcile Redux after a
  **server-side** write the client didn't make itself (the eBay sync route's
  `ebay_fulfillment_id`/`ebay_sync_error`/`ebay_synced_at`); callers do
  `const fresh = await fetchSaleById(id); if (fresh) dispatch(updateSale(fresh));`.
  Used **only** by this feature — registered centrally in `src/store/store.ts`
  and hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/salesSlice.test.ts` — reducer tests (covers `hydratePage`, `setFetching`,
  `addSale`/`removeSale` total arithmetic). Run with `npx jest dashboard/sales`.
- `_components/orderMath.ts` (+ colocated `.test.ts`) — pure `computeNetProceeds(sale)`
  helper: `total_amount + shipping_charged − shipping_cost − advertising_fee` (nulls
  treated as zero). Used by `[id]/page.tsx`. 4 unit tests.
- `_components/AddSaleModal.tsx` / `EditSaleModal.tsx` — create/edit forms.
- `_components/GenerateLabelModal.tsx` (Task 6 of the shipping-label-generation
  plan, 2026-09-06) — two-step modal: `Props { sale: Sale | null; onClose;
  onSuccess(shipment: Shipment) }`, `sale` non-null means open. Step 1
  (`"form"`) is a real `<form id="generate-label-form">` collecting
  weight (oz, required) + optional length/width/height (in) and POSTs
  `/api/shipping/rates`; step 2 (`"rates"`) renders the returned
  `EasyPostRate[]` (`@/lib/shipping/easypost`) as a radio list and POSTs
  `/api/shipping/buy` on "Buy Label". Follows this repo's mutating-button
  convention: submit button is `type="submit" form="generate-label-form"`
  living in the `Modal` footer outside the `<form>`, disabled while
  `loadingRates || !isWeightValid`; the step-2 Buy button has no native
  form (radio selection, not text input) but is disabled the same way via
  `buying || !selectedRateId`; both steps swap to a busy verb ("Fetching
  rates…"/"Buying…") while their request is in flight. Wired into
  `[id]/page.tsx`'s Shipping card — see the "## Shipping labels" section
  below.
- `_components/FeeAmountOrPercentField.tsx` — the €/% toggle input used for
  `advertising_fee`/`platform_fee` in both modals above (2026-08-27). See
  "Fee fields" below.
- `_components/ImportSalesModal.tsx` — bulk CSV import with a **format dropdown**
  (Generic / Amazon sheet / eBay sheet): parses + validates a user-uploaded CSV
  (German-tolerant — see "CSV import/export" below), runs a duplicate pre-check
  on `external_order_id`, shows per-row errors/skips grouped by reason,
  batch-inserts the importable rows via Supabase, and **then** matches Amazon
  REFUND rows against existing sales and deducts the refund from them in place
  (see "Amazon SALE/REFUND rows" below). **The insert must stay before the
  refund loop** — a monthly Amazon report routinely contains a SALE and its
  REFUND for the same order, so matching first would query `sales` before that
  SALE row exists and silently drop the refund. Dispatches `addSale`/`updateSale`
  accordingly, writes two audit log entries (the insert batch, written right
  after the insert; a refund-outcomes batch, written after the refund loop —
  see "Amazon SALE/REFUND rows"), plus one per-sale entry per applied refund,
  and reports the outcome via an `ImportSummary` passed to `onSuccess` —
  `page.tsx` turns that into a single toast (`inserted` / `skippedRows` /
  `refundsApplied` / `refundsSkipped` / `refundsExceeded` /
  `refundsAlreadyApplied` counts). `skippedRows` is the file-level skip count
  and matters more than it looks: on a real Amazon report most of the file is
  RETURN/FC_TRANSFER/blank/summary noise, so a toast without it reads as
  though the import quietly lost hundreds of rows. One clause only — the
  per-reason breakdown stays in the pre-import preview.
- `_components/importFormats.ts` (+ colocated `.test.ts`) — pure import-format
  registry: `IMPORT_FORMATS` (generic/amazon/ebay), German status synonyms
  (`normalizeStatus` — includes Amazon's `sale` → `delivered`, since Amazon's
  `status` column is a row *type*, not a fulfilment state), skip
  classification for non-sale rows (`classifySkip`/`SkipReason` — amazon
  format only), and per-row validation (`validateRowForFormat`, which also
  parses Amazon REFUND rows into an `isRefund: true`/`refund` adjustment
  instead of a row — see "Amazon SALE/REFUND rows" below). The `amazon`
  format sets two optional `ImportFormat` flags no other format uses:
  `vatRateIsFraction` (Amazon writes `0.19`, not `19`) and
  `priceColumnsAreLineTotals` (Amazon's `unit_price` column is the item LINE
  total, not a per-unit price — see "Amazon price/VAT semantics" below).
  **All import-format/validation changes go here**, not in the modal.
  Header-alias resolution (`resolveHeaders`/`canonicalizeRow`) does **not**
  live in this file — it moved to the shared `src/lib/utils/importAliases.ts`
  (also used by Expenses) during the expenses-import-formats work. This file
  imports both from there and **re-exports** them, so existing Sales call
  sites (`ImportSalesModal.tsx`, this file's own test) were unchanged by the
  move — only their definition site did.
  `resolveHeaders` matches in **two passes** — exact lowercased/trimmed header
  names first, then `normalizeHeader` (which drops a trailing parenthesised
  unit so `Gross Amount (€)` matches) for whatever key is still unclaimed. The
  ordering exists for Sales: a sheet with `Total (net)` before `Total` would
  otherwise let the net column normalise to `total`, claim the key, and get the
  real `Total` column dropped by the first-wins guard. Pinned by a test in
  `lib/utils/importAliases.test.ts`.
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
  `delivered`, `returned`, `cancelled`, `refunded`) plus an `"Other…"` option
  that reveals a free-text "Custom Status" `Input`. `EditSaleModal.saleToForm()`
  uses `isPresetStatus()` to decide whether to show the preset or fall into
  "Other" with the existing custom value prefilled. `page.tsx` renders it via
  `StatusBadge` (`components/ui/Badge.tsx`, `refunded` → `warning` — unlike
  `returned` it still counts as revenue at its reduced value) and exposes a
  Status filter (`ORDER_STATUSES` ∪ any custom values currently in `sales`,
  via `statusOptions`).
- `refunded_amount: number | null` — added by migration
  `031_sales_refunded_amount.sql` (see `supabase/CLAUDE.md`; **not yet applied
  to any tenant schema**, see "Amazon SALE/REFUND rows" below for why the
  importer's guard against it is deliberately loose). Set only by the Amazon
  REFUND import path (`ImportSalesModal.handleImport`), which also flips
  `status` to `"refunded"`. It is the **re-import idempotency marker**: a sale
  that already has one is left alone on a later import rather than deducted
  again. There is no UI to set it manually. `SaleImportData`
  (`_components/importFormats.ts`) explicitly excludes it from the shape a
  normal insert can write, so only the refund `update` path can set it.
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
- **Revenue/profit exclusion**: `isRevenueSale` (`lib/utils/filters.ts`)
  excludes a row from revenue when `status === "returned"` **or**
  `status === "cancelled"` — nothing else. It gates the Gross/VAT/Net summary
  in `page.tsx` (`summary` useMemo) and `effectiveSales` on the Overview page
  (`app/dashboard/page.tsx`). `page.tsx` shows an "N returned/cancelled
  order(s) excluded from totals" note when `excludedCount > 0`. **`refunded`
  is deliberately NOT in this exclusion** — a refunded order stays in both
  totals at its reduced `total_amount` (the REFUND import path deducts the
  refund from `total_amount`/`shipping_charged` in place, see "Amazon
  SALE/REFUND rows" below), which is what makes these figures match Amazon's
  net. Adding `refunded` here would drop the FULL order from revenue on top
  of the deduction already applied — double-counting the reduction. If you
  add new revenue aggregations in either page, filter through `isRevenueSale`
  and do not add `refunded` to it.

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

## eBay order status push-back (additive fields on `Sale`)

- **Eligibility is `isEbayIntegrationSyncedSale(sale)`** (`lib/utils/filters.ts`,
  next to `isRevenueSale`) — `platform === "ebay" &&
  external_order_id?.includes(":")`. **Do not re-inline `platform === "ebay"
  && external_order_id` anywhere**: a CSV-imported eBay row also satisfies
  that (`importFormats.ts` copies the sheet's raw `order_id` into
  `external_order_id`), but it has no `":"` line-item suffix, so the sync
  route can't recover a `lineItemId` and eBay rejects it forever — the user
  would be forced through required Carrier/Tracking fields for a sync that
  can never succeed. Both `EditSaleModal.tsx` and the sync-status route call
  this one function. It lives in `lib/utils/` rather than
  `lib/integrations/` because the modal is a Client Component and the
  project verifier blocks `@/lib/integrations/*` imports from `"use client"`
  files.
- `tracking_number`/`shipping_carrier: string | null` — captured in
  `EditSaleModal.tsx` only when `isEbayIntegrationSyncedSale(sale)` and the
  Status field is set to `"shipped"`: two additional required fields
  (Carrier — a `Select` from `EBAY_CARRIER_CODES`,
  `src/lib/integrations/ebay/carriers.ts`; Tracking Number — a required
  `Input`), prefilled from the sale's existing values (e.g. a retry after a
  failed sync). **These two columns are only overwritten by a save that sets
  the order TO `"shipped"`** — every other save passes the sale's existing
  values through unchanged. (They used to be nulled on any non-shipped
  status, which erased the record of what was pushed to eBay on the perfectly
  normal shipped → delivered step, while `ebay_fulfillment_id` survived, and
  left an outstanding Retry resending nulls.)
- `ebay_fulfillment_id`/`ebay_synced_at: string | null` — written only by the
  server route below, never by the client. `ebay_sync_error` is written by
  that route **and** by `EditSaleModal` (see the accountant note below).
- **After** the `sales.update(...)` succeeds (not before — the local save
  must never be blocked by eBay), if `status` transitioned *into*
  `"shipped"` or `"cancelled"` on an eligible eBay sale, `EditSaleModal`
  fire-and-awaits `POST /api/integrations/ebay/orders/[saleId]/sync-status`
  (`src/lib/integrations/SKILL.md`'s "eBay order status push-back" section
  has the full route contract). A non-OK response or a thrown `fetch`
  (both caught) shows a `warning()` toast — "Saved locally, eBay sync
  failed" — it never blocks `onSuccess()`/`onClose()`. `AddSaleModal` is
  untouched: a sale can only be `platform === "ebay"` with a real
  `external_order_id` via the Integrations sync/import pipeline, never via
  manual creation.
- **On any sync failure the modal also writes `ebay_sync_error` itself**, via
  the same tenant client it used for the sale update. The route is gated by
  `requireIntegrationAdmin()` (`manage_integrations` — admin/super_admin),
  but this modal is reachable by anyone with `update_sale`, which includes
  **`accountant`**. An accountant's save is 403'd *before* the route touches
  the row, so without this client-side write the order would silently never
  reach eBay and no Retry row would ever appear for an admin to find. The
  write is safe — the same user just successfully updated the same row.
- **Redux is reconciled after the attempt settles** (success *and* failure):
  `fetchSaleById(sale.id)` from `_store/salesSlice.ts` + `dispatch(updateSale
  (fresh))`. The `data` returned by the modal's own `.update().select()` is
  the *pre*-sync row; the `ebay_*` columns are written afterwards. Since
  `[id]/page.tsx` renders `storeVersion ?? fetchedSale` and never re-fetches
  once a store version exists, skipping this reconcile means the Retry row
  never appears — and a stale error from an earlier attempt never clears —
  until a hard page reload.
- Included in the same before/after audit-log diff as every other editable
  field.
- **Retry a failed sync**: the order detail page
  (`dashboard/sales/[id]/page.tsx`) shows a warning row when
  `sale.ebay_sync_error` is set ("eBay sync failed: `<message>`" + a Retry
  button), re-POSTing the same route with the sale's current
  `status`/`tracking_number`/`shipping_carrier` — no modal, nothing to
  re-enter. On success it calls the same `fetchSaleById` + `updateSale`
  pair, which clears the row (a successful sync clears `ebay_sync_error`
  server-side). The **Retry button only renders when `sale.status` is
  `"shipped"` or `"cancelled"`** — the only two the route handles;
  `handleRetrySync` guards on the same condition. The error text itself
  still renders for any other status (with a line telling the user to set
  the status back), so a failure is never invisible.

## Buyer shipping address (additive fields on `Sale`)

Nine nullable columns (migration `041_sales_shipping_address.sql`, see
`supabase/SKILL.md`): `buyer_name`, `shipping_address_line1`,
`shipping_address_line2`, `shipping_city`, `shipping_state`,
`shipping_postal_code`, `shipping_country`, `buyer_phone`, `buyer_email`.

- **Automatic capture (eBay only)**: `src/lib/integrations/ebay.ts`'s
  `fetchOrders` extracts `fulfillmentStartInstructions[].shippingStep.shipTo`
  per order (order-level, duplicated onto every line item's
  `NormalizedOrder.shipping`, same as `date`/`description`) and
  `mapToSale.ts`'s `normalizedOrderToSaleRow` spreads it onto the insert row,
  all nine `null` when `order.shipping` is missing/null. Amazon's adapter is
  untouched — its `NormalizedOrder`s leave `shipping` `undefined`
  (SP-API's order-address endpoint needs a separate PII-access grant this
  app doesn't request), and `mapToSale.ts` already treats an absent field as
  "no data".
- **Manual capture/edit (any platform)**: `AddSaleModal`/`EditSaleModal` both
  have a collapsible "Shipping Address (optional)" section (same
  chevron/collapse pattern as "Fees & shipping (optional)" —
  `showShipping` boolean). None of the nine fields are `required`.
  `EditSaleModal`'s section auto-opens when the sale being edited already
  has at least one of the nine fields set, same rule as the Fees section.
  Included in the `sales.update(...)` payload and the before/after audit-log
  diff, same as every other editable field group.
- **User-owned on re-import**: all nine are preserved from the existing row
  on a re-sync (`mergeImportedSale.ts` — see
  `src/lib/integrations/SKILL.md`'s Merge rule section) — a seller's manual
  correction to a wrong or incomplete auto-captured address survives a later
  status-change re-import of the same order.
- **Display**: `[id]/page.tsx`'s Details card renders a "Shipping Address"
  block (bold `buyer_name` line, address lines, `city, state postal_code`,
  `country`, then phone/email as small muted lines) only when at least one
  of the nine fields is non-null — same visual weight as the card's other
  rows, not a separate card.
- `shipping_country` is free text on purpose (not a fixed-list `Select`) —
  eBay returns a 2-letter code, a manual entry might not; validation is
  deferred to the future label-purchase feature that actually needs a valid
  country code.

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
- `lib/utils/importAliases.ts` — shared header-alias vocabulary and
  `resolveHeaders`/`canonicalizeRow` (also used by Expenses); `importFormats.ts`
  re-exports both so this feature's own call sites didn't need to change
- `types` (`Sale`, `Platform`, `Currency`, `Product`)

## Fee fields (`shipping_cost`, `shipping_charged`, `advertising_fee`, `platform_fee`)

All four are `number | null` on `Sale`. `platform_fee` (added 2026-08-27 —
the marketplace's own commission, e.g. eBay's final value fee or Amazon's
referral fee, distinct from `advertising_fee`'s Promoted Listings/Sponsored
Products spend) follows the exact same shape and treatment as the other
three everywhere below — search for `advertising_fee` in this codebase
before assuming a fee-related change only needs one field touched. They
surface in:
- `AddSaleModal` / `EditSaleModal` — collapsible "Fees & shipping (optional)" section
  (state-controlled `showFees` boolean + chevron toggle). Empty string → `null`, never `0`.
  `EditSaleModal` auto-opens the section when the existing sale has at least one fee set.
  Fee changes are included in the before/after audit-log diff alongside all other fields.
  **`advertising_fee`/`platform_fee` specifically** (not shipping) use
  `_components/FeeAmountOrPercentField.tsx` (2026-08-27) instead of a plain
  `Input` — a €/% toggle lets the fee be entered as a percentage of the
  order's item total (`qty × unit_price`); switching to `%` computes and
  stores the resulting flat amount via `computeFeeFromPercent`
  (`lib/utils/currency.ts`), same as typing it directly. **The percentage
  itself is never persisted** — only the computed flat amount is — so
  reopening an existing sale always shows amount mode with the stored flat
  value, never re-derives or shows a percentage.
- `ImportSalesModal` — optional CSV columns `shipping_cost`, `shipping_charged`,
  `advertising_fee`, `platform_fee` in every import format. Blank/missing → `null`.
  Non-numeric or negative → row error. Validated in `validateRowForFormat()`
  (`_components/importFormats.ts`) via a shared `fee()` closure parametrized
  by column key — adding a 5th fee column means adding one more call to that
  closure plus its `if (x.error) return fail(...)` line, not new validation
  logic. **Despite its name, `ImportSalesModal.test.ts` has zero modal tests**
  — it only exercises `validateRowForFormat` against the `generic` format
  (fee-field cases). The modal component itself (`ImportSalesModal.tsx`) is
  untested; don't cite this file as modal coverage. Fee-field validation is
  also covered in `importFormats.test.ts`. CSV import/export is
  **amount-only, no `%` notation** — platform-exported reports already give
  fees as flat currency values, so the percent-entry convenience only exists
  in the manual Add/Edit forms and the Review Orders page (below).
- `page.tsx` — exported in `handleExport()`; computed "Fees" column in the table
  (value: `shipping_cost + advertising_fee + platform_fee`, displays `—` only
  when all three are `null`).
- `_lib/aggregateSales.ts`'s (in `dashboard/_lib/`, feeds the Overview page's
  Net Profit) `fees` sum also includes `platform_fee` — added in the same
  change specifically so Overview's Net Profit doesn't silently drift from
  `orderMath.ts`'s per-order `computeNetProceeds` once a tenant starts using
  the new field.
- **Review Orders** (`dashboard/integrations/review/page.tsx`) — see
  `dashboard/integrations/CLAUDE.md`'s Fee entry section. Per-order Ad
  Fee/Platform Fee `€`-only inputs (no percent toggle — table row space) plus
  a bulk "apply X% of this order's total to every selected row" toolbar,
  since neither eBay's nor Amazon's order-listing API returns a fee
  breakdown. Threaded through `normalizedOrderToSaleRow`'s new optional 4th
  `fees` argument (`lib/integrations/mapToSale.ts`) — `undefined`/omitted
  still defaults both to `null`, so every other caller of that function is
  unaffected.

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
`YYYY-MM-DD`, `DD.MM.YYYY`, or `/`-/`-`-separated day-first or month-first
(`parseFlexibleDate`; two-digit years rejected — see "Date-order detection"
below for which order a given file is read with), German **header aliases**
(`Datum`, `Artikelname`, `Menge`, `Preis`, `MwSt`, `Bestellnummer`, … — the
`ALIASES` map in `importFormats.ts`). Files that fail UTF-8 decoding are
re-read as `windows-1252` (German Excel default). Unknown columns are ignored;
missing required columns are a file-level error.

**Date-order detection (per file, not per row):** `10-04-2026` is genuinely
ambiguous — day-first (10 April) and month-first (4 October) are both valid
calendar dates, and nothing in the string says which is meant. Before
validating any row, `ImportSalesModal` canonicalises the whole file and calls
`detectDateOrder` (`lib/utils/localeParse.ts`) over every value in the `date`
column: a `/`- or `-`-separated date where one side is >12 and the other ≤12
is hard evidence for that order (`30-04-2026` can only be day-first). Dot
separated dates (`15.01.2024`) carry no evidence — they're always read
day-first regardless. Outcomes:

- **Confident, single order** — all evidence in the file agrees; that order
  is used for every row. The Date format dropdown shows "Auto — detected
  DD-MM-YYYY" (or MM-DD-YYYY).
- **No evidence either way** — every date reads the same both ways, or the
  file has none of the ambiguous separated form. The dropdown shows "Auto —
  could not tell, assuming DD-MM-YYYY" and a note below it shows a concrete
  "`<real date from the file>` will be imported as `<D Month YYYY>`" preview
  (`firstAmbiguousDate` + `parseFlexibleDate` in `ImportSalesModal.tsx`) —
  **not** a "check the preview" pointer, since the modal has no row preview
  to check.
- **Evidence conflict** — the file contains hard evidence for BOTH orders (a
  genuinely mixed file, e.g. both `30-04-2026` and `04-30-2026`). The import
  is refused outright with a file-level error naming the two conflicting
  sample dates.
- **Separator conflict** — the date column mixes `/` and `-` separators
  (e.g. `30-04-2026` alongside `04/09/2026`). This is refused even when no
  single value proves both orders — it's the signature of a spreadsheet tool
  (Excel) silently rewriting the cells it could read as a date while leaving
  the rest as text, which is exactly the corruption that motivated this
  feature (see "Gotchas — date-order detection" in `SKILL.md`) and which
  per-value evidence alone cannot see, because the rewritten cells have both
  fields ≤ 12 by construction. `detectDateOrder`'s `conflict.kind` field
  (`"evidence" | "separator"`) distinguishes the two; there is no partial
  import of a conflicting file either way.
- **Dot-only file** — when every date in the file is dot-separated, `order`
  has no effect at all (dot dates are always day-first — see below), so the
  Day-first/Month-first selector is disabled with a one-line explanation
  instead of silently doing nothing.

The user can override the detected/assumed order via the "Date format"
dropdown next to the format dropdown (Auto / Day first / Month first) —
disabled when the file has no order-sensitive dates (dot-only, above). If the
file has confident single-order evidence, picking the opposite order is also
refused ("This file can only be read day first (DD-MM-YYYY) — it contains a
date whose other reading is not a real month. Set the date format back to
Auto.") — that reading would produce dates that don't exist. Re-parsing
re-runs (`parseAndValidate`) on every format or date-order change; a run-id
guard in `ImportSalesModal.tsx` discards the result of a call superseded by a
newer one before it resolves (see "Gotchas — date-order detection" in
`SKILL.md`).

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

**`classifySkip` (amazon format only):** Amazon's `status` column is a row
**type**, not a fulfilment state — a real VAT report is mostly non-sale rows.
`classifySkip` marks these `skipped` with a reason rather than erroring,
since validation is all-or-nothing and erroring on them would make a real
export impossible to import: blank filler rows, a trailing "Total" summary
row (detected structurally: no `date`/`product_name`/`quantity` — the
heuristic is **skipped for `status === "refund"` rows**, which have no `date`
by design and would otherwise all be swallowed as "summary row"; the
carve-out is scoped to that one check, not an early return, so a refund is
still subject to the currency guard), unsupported
currencies, and **`RETURN`/`FC_TRANSFER`** status rows — pure logistics
noise, skipped *before* field validation because they legitimately have no
`date` at all (this ordering is what fixed a prior `Row N: invalid or
missing "date"` failure on every RETURN line). **`REFUND` is deliberately
NOT skipped here** — see "Amazon SALE/REFUND rows" below: it parses into a
`refund` adjustment instead of a row. The format guard (`if
(!format.priceColumnsAreLineTotals) return null`) must stay the first
statement in the function — putting the blank-row check above it would make
`generic` and `ebay` silently skip blank rows instead of erroring them.

**Amazon SALE/REFUND rows:** only `SALE` and `REFUND` carry importable money;
`RETURN`/`FC_TRANSFER` are skipped as noise (above). Like `RETURN`, a
`REFUND` row has an EMPTY `date` column (confirmed against a real report
row — see `importFormats.test.ts`'s "Amazon REFUND rows" tests), so
`validateRowForFormat`'s refund-parse branch runs *before* the date parse —
moving it after would reintroduce a `Row N: invalid or missing "date"`
failure on every REFUND line. A `REFUND` never becomes a row — `data` is
`null` and it never enters `importable`/`payload`. It deducts from an
existing sale instead:

- **Match key**: platform + `external_order_id` + resolved `product_id`
  (from `sku`). Amazon order ids are not unique *within a sheet* — a
  multi-line order repeats its id once per SKU — but only one of those lines
  can ever reach `sales`: the unique index on `(platform,
  external_order_id)` is non-partial, and `markDuplicates`' in-file pass
  marks the rest `"duplicate in file"`. So the key does not protect against
  deducting the wrong line (impossible); what it does is make a refund
  against any *other* line of a multi-line order resolve a `product_id` that
  matches nothing, so it is reported as "no matching order found" rather than
  silently deducted from the one line that did import. No `product_id`
  (unmapped `sku`) → unmatched.
- **Split across two columns**: a SALE's `total_amount` holds the item total
  only — shipping lives in `shipping_charged` — so the refund is parsed
  (`validateRowForFormat` in `importFormats.ts`) into `amount` (full,
  `refunded_amount`), `itemAmount` (deducted from `total_amount`) and
  `shippingAmount` (deducted from `shipping_charged`). When the sheet's
  `unit_price` is blank, `itemAmount` is backed out of `amount` using the
  row's `shipping_charged`, mirroring the SALE branch's `sheetTotal - ship`
  derivation. A row whose parts don't sum to the whole
  (`itemAmount < 0 || itemAmount > amount`) is a row error, not a guess —
  writing a deduction that disagrees with its own `refunded_amount` would be
  unauditable.
- **VAT is scaled proportionally, not subtracted, when Amazon reports none.**
  Amazon's REFUND line reports `TOTAL_ACTIVITY_VALUE_VAT_AMT` as **0**, so
  subtracting it would leave a refunded order carrying its full pre-refund
  `vat_amount` (order `304-8612000-9060321` → `total_amount 0.06`,
  `vat_amount 1.28`, making Net = gross − vat = **−1.22** and feeding €1.28
  of VAT on €0.06 of goods into the Overview VAT Position and the invoice
  PDF — a filed tax number). So: when the refund carries a **non-zero**
  `vatAmount`, it is subtracted (Amazon's own figure wins); otherwise
  `vat_amount` is scaled by the gross that survives —
  `previous.vat_amount × (nextGross / prevGross)`, where gross is
  `total_amount + (shipping_charged ?? 0)` — guarded on `prevGross > 0` and
  floored at 0, and left `null` when it was already `null`. Scaled rather
  than recomputed from `vat_rate` because `vat_amount` is the combined
  item+shipping figure and the two can carry different rates (the Swedish
  25% shipping rows above), so a single-rate recomputation is wrong on a
  mixed-rate order; scaling preserves the order's blended effective rate.
  This is what makes the *VAT* figure match Amazon's net too, not just
  revenue.
- **A refunded order's `unit_price` is deliberately left at its pre-refund
  value.** The refund path updates `total_amount`/`shipping_charged`/
  `vat_amount`/`status`/`refunded_amount` only, so an invoice or CSV export
  shows e.g. `8.05 | 0.06` (unit price | total) on one line. That is
  intentional: `unit_price` records what the item was sold at, and every
  total is computed from `total_amount`, so the figures are correct. Don't
  "fix" it by back-deriving `unit_price` from the reduced total.
- **`refunded_amount` is the re-import idempotency marker.** A matched sale
  that already has one (`previous.refunded_amount != null`) is a no-op —
  counted as `refundsAlreadyApplied`. Consequence: a second, separate refund
  against the same order is skipped rather than accumulated — one refund per
  order is a hard limit of this column, not a v1 shortcut (see the SKILL.md
  gotcha). **The check is `!=`, not `!==`, on purpose**: migration `031_sales_refunded_amount.sql` is not yet
  applied to any tenant schema, so `previous.refunded_amount` reads as
  `undefined` there, and `undefined !== null` is `true` — a strict check
  would silently classify every refund as already-applied and deduct nothing
  while still showing a success toast. Do not tighten this until the
  migration is confirmed live everywhere. This guard runs **before** the
  over-refund check below, since a fully-refunded order's `total_amount` is
  `0` and checking order the other way round would misreport a re-import as
  "exceeds the order".
- **Over-refund is a per-row skip (`refundsExceeded`), not an import abort**
  — a match is skipped, not deducted, when `itemAmount`/`shippingAmount`
  exceed the matched sale's stored `total_amount`/`shipping_charged` by more
  than the same `0.02` tolerance the SALE branch reconciles with. The write
  floors `total_amount`, `shipping_charged`, and `vat_amount` at `0`, so a
  within-tolerance overshoot can leave `refunded_amount` up to 2c above what
  was actually deducted — a deliberate, bounded trade against writing a
  negative total that would corrupt every revenue aggregate.
- **Unmatched refunds are skipped** (`refundsSkipped`), not inserted
  standalone — a non-partial unique index on `(platform, external_order_id)`
  exists in every tenant schema (verified live), so a standalone insert for
  an existing order id would raise a unique violation and fail the whole
  batch. Unlike the file-level skip reasons above, an unmatched/exceeded/
  already-applied refund is **not** surfaced as a `ParsedRow.skipped` reason
  in the pre-import preview — matching only happens during `handleImport`,
  and the outcome is reported post-import via `ImportSummary` (see the
  `ImportSalesModal.tsx` bullet above) and `page.tsx`'s toast.
- **On a Supabase error matching or updating a refund** (`matchErr`/
  `updErr`), the modal clears `parsed` (`blockRetry()`) so Import cannot be
  re-clicked — a retry would re-insert the already-committed SALE rows and
  trip the unique index.
- **A refunds-only file is importable.** A REFUND row has `data: null` and
  is never in `importable`, so `canImport`/the Import-button row count
  (`actionableCount`) count `refundCount` alongside `importable.length` —
  otherwise a file containing only refunds would read as "Import 0 rows".

**Duplicate pre-check (I3):** rows carrying an `external_order_id` are checked
against existing `sales` rows per `(platform, external_order_id)` (chunked
`.in()` queries, 200 ids per chunk) and against duplicates within the file.
Matches are marked **skipped** and are never overwritten (same protection as
the integrations re-sync merge rule). REFUND rows are exempt from both dedup
passes (file-level and DB-level, `markDuplicates` in `ImportSalesModal.tsx`)
— they carry the `external_order_id` of an *existing* sale by definition, so
without the carve-out every refund would be marked "order already exists" and
dropped before the matching path in "Amazon SALE/REFUND rows" above ever
runs, making the feature unreachable. Skips don't block importing the
remaining rows; validation errors still do. The modal groups file-level skip
reasons (duplicate, blank row, summary row, not a sale, unsupported currency,
…) via `skipReasonCounts` and names each one in the summary text — refund
match/skip outcomes are a separate, import-time thing (see above), not part
of this grouping.

`product_id` is resolved automatically when the row carries a `sku` that matches
an inventory product (see `sku` above); otherwise it is `null` — user can link
via Edit afterward. `vat_amount` is computed via `vatAmountFromGross`
over `total_amount`, unless the file supplies a `vat_amount` column directly
(amazon/ebay only), which wins. `restock` is always `false` for newly
**inserted** rows (not importable — edit the record afterward to mark it
returned/restockable); REFUND rows never touch `restock` at all — they update
`status`/`total_amount`/`shipping_charged`/`vat_amount`/`refunded_amount`
only (see "Amazon SALE/REFUND rows" above). Audit log: one entry written
right after the insert with `{ bulk_import, count, format, skipped }` (omit
`entityId` — it's `string | undefined`, not nullable) — **only when
`inserted.length > 0`**, so re-importing last month's file, where every SALE
is skipped as a duplicate, no longer writes a `create sale` entry claiming a
bulk import of 0 records; one per-sale entry for
each **applied** refund (`action: "update"`, before/after
status/total_amount/shipping_charged/vat_amount/refunded_amount diff), and —
only when the file had refund rows — a second batch entry after the refund
loop with `{ refunds_applied, refunds_unmatched, refunds_already_applied,
refunds_exceeded, unmatched_order_ids, already_applied_order_ids,
exceeded_order_ids }`. The insert entry is written before the refund loop can
run so it survives a mid-loop abort; the refund-outcomes entry can only exist
after the loop finishes.

## Shipping labels (`src/lib/shipping/`)

`[id]/page.tsx` has a third card, **Shipping**, below Financials/Details,
rendered for every sale in one of three states: (1) no shipment yet and
either the tenant's `CompanyProfile.ship_from_*` fields or the sale's
`shipping_*`/`buyer_*` fields are incomplete — a muted message + link to
Settings, no button; (2) no shipment yet, both addresses complete — a
"Generate Shipping Label" `Button` (admin/super_admin only, gated by a
`currentRole` selector defined **before** the page's early
loading/not-found returns, alongside `isSuperAdmin`/`hasDeleteOverride` —
see the gotcha in this feature's `SKILL.md` for why) opens
`_components/GenerateLabelModal.tsx`; (3) a shipment exists — read-only
carrier/service/tracking number/cost + a "Download Label" link. Like the
linked purchase, the shipment is fetched on-demand
(`.from("shipments").select("*").eq("sale_id", sale.id).maybeSingle()`) on
mount, not hydrated globally — no Redux slice, since a sale has at most one
shipment in v1. The address-completeness check duplicates
`src/lib/shipping/addressMappers.ts`'s throw-on-missing checks client-side
so the button never appears when it's guaranteed to fail server-side. See
`src/lib/shipping/SKILL.md` for the EasyPost wrapper, the address mappers,
and the two `/api/shipping/*` routes this card and modal call.

## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
