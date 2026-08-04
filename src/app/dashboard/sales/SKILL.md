---
name: sales-feature
description: Work on the Sales dashboard feature (list, add/edit/delete sales records, invoices) at src/app/dashboard/sales — use when the task mentions sales, sale records, or the /dashboard/sales route.
---

# Working on the Sales feature

This feature is fully colocated under `src/app/dashboard/sales/`. Read
`CLAUDE.md` in this folder first — it explains the file map and the
Supabase-write → slice-update → audit-log data flow every mutation follows.

## Minimal file set for common changes

- **Add/change order-detail page content**: `[id]/page.tsx` only. For net-proceeds
  or gross-profit formula changes also touch `_components/orderMath.ts` + its test.
- **Wire the Download Invoice button** (Phase 5 — DONE): `[id]/page.tsx` — the
  button now calls `handleDownloadInvoice()` which calls `generateOrderInvoice(sale,
  companyProfile)` from `@/lib/utils/generateInvoice`. `companyProfile` is read from
  `useAppSelector((s) => s.companyProfile.profile)` (hydrated by the dashboard
  layout). Button stays disabled only while `companyProfile` is null.
  - Per-order invoice recipe lives in `generateInvoice.ts → generateOrderInvoice`.
    Uses `invoiceNumberFor` (deterministic, id-based) and `computeOrderInvoiceTotals`
    from `invoiceMath.ts`. Logo is fetched async before `addHeader` is called and
    passed as a pre-resolved `logoDataUrl` string parameter.

- **Add/change a field on a sale**: `_components/AddSaleModal.tsx` (create form),
  `_components/EditSaleModal.tsx` (edit form + before/after audit diff),
  `_store/salesSlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Sale` type. Also check `page.tsx` if the field
  needs to render in the table or be filterable (`lib/utils/filters.ts`).
  **Also update `_components/importFormats.ts`** if the new field should be
  importable — add an `ALIASES` entry (EN + German header names), a `col(...)`
  to each format's `columns`, template headers/example, and validation in
  `validateRowForFormat()`. The modal itself rarely needs to change.
- **Add/change an order status**: `_components/orderStatus.ts` (`ORDER_STATUSES`
  preset list + `statusLabel`/`isPresetStatus`) and its colocated test. Also
  check `StatusBadge` in `src/components/ui/Badge.tsx` for a variant mapping if
  you add a new preset that should render with a non-default color.
- **Change list/filter/table behavior**: `page.tsx` only.
- **Change server-side filter pushdown logic**: `_store/salesSlice.ts` →
  `fetchSalesPage` thunk. Filters map: `preset`/`dateFrom`/`dateTo` →
  `gte/lte("date", ...)`, `platform` → `eq("platform", ...)`,
  `currency` → `eq("currency", ...)`, `status` → `eq("status", ...)`.
- **Change pagination defaults** (page size, etc.): `src/lib/utils/pagedQuery.ts`
  (`DEFAULT_PAGE_SIZE`) — affects all features once they adopt this pattern.
- **Change reducer logic**: `_store/salesSlice.ts` + its test.
- **Change export columns**: `handleExport()` in `page.tsx` — edit the `headers`
  array and the row-mapping lambda.
- **Change import validation / accepted columns / header aliases / add a new
  import format**: `_components/importFormats.ts` only (pure registry —
  `IMPORT_FORMATS`, `ALIASES`, `validateRowForFormat`). Extend
  `importFormats.test.ts` in the same commit. Locale parsing primitives
  (decimal commas, German dates, delimiter detection) live in
  `src/lib/utils/localeParse.ts` and `src/lib/utils/csv.ts`.

## Test command

`npx jest dashboard/sales` — runs `_store/salesSlice.test.ts` and
`_components/orderMath.test.ts` (and any other `*.test.ts` colocated here).

## Gotchas — fee fields

- `shipping_cost`, `shipping_charged`, `advertising_fee` are all `number | null`.
  Empty string in form state → `null` before the DB write (never `0`). This is the
  same pattern as `vat_rate`/`vat_amount`.
- `EditSaleModal` auto-opens the "Fees & shipping" section when the existing sale has
  at least one fee non-null (checked in the `showFees` initializer).
- Import validation lives in `validateRowForFormat()` in the pure
  `_components/importFormats.ts` (unit-tested in `importFormats.test.ts` and
  `ImportSalesModal.test.ts`); the modal only orchestrates file reading, the
  dedup query, and inserts.
- The table "Fees" column sums `shipping_cost + advertising_fee` (seller costs);
  `shipping_charged` is not in the computed sum — it's the buyer-facing amount and
  appears only in the CSV export.

## Gotchas — CSV import formats (German support)

- **`Versandkosten` maps to `shipping_charged`** (what the buyer paid — I6), NOT
  `shipping_cost`. Seller-side shipping needs an explicit `shipping_cost` /
  `versandkosten_bezahlt` header. Don't "fix" this mapping without reading
  IMPORT_PLAN.md decision I6.
- **Encoding fallback**: `readFileText()` in `ImportSalesModal` reads UTF-8 first
  and re-reads as `windows-1252` when the decode contains `�`. German Excel CSVs
  are usually windows-1252; don't remove the fallback.
- **Duplicate pre-check chunks `.in()` at 200 ids** (`IN_CHUNK`) — Supabase/
  PostgREST URLs break on very long `in()` lists. Keep chunking if you touch it.
- **Skipped ≠ error**: rows marked `skipped` (order already exists / duplicate in
  file) don't block the import; rows with `error` do. `canImport` requires zero
  errors AND ≥1 importable row.
- **Never derive numbers with `parseFloat` in import code** — always
  `parseLocaleNumber` (`"9,99"` would silently become `9`). Same for dates:
  `parseFlexibleDate`, never a bare regex.
- The delimiter is auto-detected per file (`detectDelimiter` in
  `lib/utils/csv.ts`) — affects the purchases/expenses imports too, since they
  share `parseCsvText`.

## Gotchas — Amazon VAT-report import (`priceColumnsAreLineTotals`/`vatRateIsFraction`)

- **`total_amount` stores the ITEM line total, never the sheet's `total`.**
  `app/dashboard/_lib/aggregateSales.ts:25` computes revenue as `total_amount
  + shipping_charged`, so storing the shipping-inclusive sheet total there
  double-counts shipping. `total` is used only to validate `total ≈
  total_amount + shipping_charged`, then discarded.
- **Amazon's `unit_price` column is optional; when it's absent, back the item
  total OUT of the sheet total** (`sheetTotal - shippingCharged`) — using the
  sheet total raw reopens the same double-count as above. See
  `validateRowForFormat`'s `priceColumnsAreLineTotals` branch in
  `importFormats.ts`.
- **Amazon writes VAT rates as fractions (`0.19`), not percentages.** Scaling
  is driven by the `vatRateIsFraction` format flag, never by the value's
  magnitude — an `if (rate < 1)` check would silently mishandle a genuine
  100% rate.
- **In `classifySkip` the format guard (`if
  (!format.priceColumnsAreLineTotals) return null`) must be the FIRST
  statement.** Putting the blank-row check above it makes `generic` and
  `ebay` silently skip blank rows instead of erroring them — those two
  formats must keep their pre-existing all-or-nothing validation behaviour.
- **RETURN rows must be exempt from BOTH duplicate pre-check passes**
  (file-level dupes and the DB `.in()` check in `markDuplicates`) — they
  carry the `external_order_id` of an existing order by definition, so
  without the carve-out every return is dropped as "order already exists"
  and the matching path in `handleImport` never runs.
- **Amazon order ids are NOT unique** — a multi-line order (one line per SKU)
  repeats the same `order_id`. Return matching keys on platform +
  `external_order_id` + resolved `product_id`, never `external_order_id`
  alone, or the wrong line gets flipped.
- **Unmatched returns are skipped, not inserted.** A non-partial UNIQUE index
  on `(platform, external_order_id)` exists in every tenant schema (verified
  live) — a standalone insert for an order id with no matching line (or a
  second line of an already-matched order) raises a unique violation and
  fails the *whole* batch, not just that row. `handleImport` marks these
  `skipped: "return: no matching order"` instead.
- **The `ParsedRow.isReturn` JSDoc in `importFormats.ts` is stale** — it says
  an unmatched return "inserts this row standalone", which was the original
  design but is no longer what the code does (see the point above). Don't
  trust that comment; the modal's `handleImport` is the source of truth.

## Gotchas — server-side pagination

- **Do not call `filterSales()` in `page.tsx`** — filters are pushed to Supabase
  in `fetchSalesPage`. Calling the in-memory helper would silently double-filter
  and produce wrong counts.
- **`state.sales.items` is always one page** (up to `pageSize` rows). Any code
  that assumes `items` contains all records (e.g. the Overview page's
  `effectiveSales`) reads from its own copy of the data, not from here —
  but be careful when adding new aggregations.
- **DataTable column sorting is page-local** (v1 deliberate limitation). Users
  who want a globally sorted view should use the date ordering already applied
  server-side. If full sort pushdown is added later, extend `fetchSalesPage`
  with an `order` param.
- **`statusOptions` in `page.tsx`** is derived from the current page only.
  Custom statuses not on the current page won't appear in the filter dropdown
  until a matching page is loaded. This is an acceptable v1 trade-off.
- **`addSale` increments `total`** so the Pagination count stays accurate after
  a manual add without re-fetching. `removeSale` decrements it only when the
  item was actually found in `items` (prevents double-decrement on a no-op).
- **`StoreProvider` prop shape changed**: `sales` is now
  `{ data: Sale[], count: number }` (not `Sale[]`). Layout passes
  `{ data: salesData ?? [], count: salesCount ?? 0 }`. If you add a new
  feature prop with the same shape, follow this pattern.
- **CSV export** runs a separate Supabase query without `.range()` — it does
  NOT use the Redux items. This ensures the export always covers all matching
  records (up to the 5 000-row safety cap), even when the user is on page 3.
- **`returnedCount` is page-scoped** — it counts returned orders within
  `state.sales.items` (the current page), not across all matching rows. The UI
  note "N returned order(s) excluded from totals" is therefore page-local; it
  is not labelled "(this page)" in the UI, but that is what it reflects.
- **Invoice modal falls back to current page only when nothing is selected** —
  `InvoiceModal` receives the `selected` rows array. When `selected` is empty,
  it has no records to render; the Generate Invoice button is disabled until at
  least one row is checked. Selection is page-local (cleared on page navigation),
  so a user cannot span an invoice across multiple pages in v1.

## Gotchas — detail page

- `params` is a **Promise** in this Next.js version. Use React's `use(params)` (not
  `await`) in Client Components to unwrap it — see
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
- Direct-URL hits to `/dashboard/sales/[id]` land before the layout hydrates Redux,
  so `state.sales.items` may be empty. The page falls through to a Supabase fetch via
  `createTenantClient` and then dispatches `addSale` to populate Redux.
- **Linked purchase on the detail page**: the Financials card shows Cost of Goods and
  Gross Profit rows when a `Purchase` with `sale_id === sale.id` exists. The page
  first checks `state.purchases.items` (fast path — already populated by the layout on
  normal navigation); if not found it fires a second `useEffect` that queries the
  `purchases` table with `.maybeSingle()` (won't throw on no-row), then dispatches
  `addPurchase` to hydrate Redux AND sets local `fetchedLinkedPurchase` state.
  Use `.maybeSingle()`, not `.single()` — the purchase may genuinely not exist.
  The guard `purchases.some((p) => p.sale_id === sale.id)` skips the Supabase fetch
  when Redux already has the row (avoids a redundant round-trip on list → detail nav).
- The `EditSaleModal` prop `sale` controls open/close: pass `null` to close, a
  `Sale` object to open. On the detail page, pass `editOpen ? sale : null` so closing
  the modal transitions back cleanly.
- Delete navigates to `/dashboard/sales` after removing the item from Redux — same
  audit-log + product-stock-refetch pattern as the list page.
- **Download Invoice** calls `generateOrderInvoice` (not `generateSalesInvoice`) —
  the per-order variant uses `invoiceNumberFor` (deterministic, id-based) and
  `computeOrderInvoiceTotals` from `src/lib/utils/invoiceMath.ts`. The button is
  transiently disabled on hard-refresh until `companyProfile` hydrates from Redux.

## Gotchas

- `salesSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` — those two files import it via the `@/app/dashboard/sales/_store/salesSlice`
  alias. If you rename the slice file, update those imports too.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Expenses and Purchases
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
- `Sale.product_id` is optional and FK's to `products` (Inventory feature) —
  the modals just set it via a `Select`; a DB trigger keeps `current_stock` in
  sync. Never write to `products.current_stock` from here.
- The "Inventory Product" dropdown's filter/auto-fill logic lives in the
  colocated `productOptions.ts` (`selectableProducts`, `productNameFor`) —
  pure functions, unit-tested in `productOptions.test.ts`. Edit *that* file if
  the selection rules change, not the inline JSX in the modals.
  `EditSaleModal` passes its `form.product_id` as the second arg so the
  sale's existing link stays visible even at 0 stock — keep that "don't drop
  the existing link on edit" guard. Selecting a product also auto-fills
  `product_name` — don't remove that or the free-text name and the link can
  drift apart again.
- `Sale.vat_rate`/`vat_amount` are populated only when "Total includes VAT" is
  checked (`Checkbox` + `vatAmountFromGross`); send `null` for both when it's
  off — see `CLAUDE.md` → "Inventory link + VAT" for the full pattern, which is
  identical across Sales/Purchases/Expenses modals.
- `writeAuditLog` `entityId` param is `string | undefined` — **not nullable**.
  For bulk-import audit entries (one log per batch), simply omit `entityId`
  rather than passing `null`. Passing `null` is a TypeScript error.
- **Returned orders are excluded from revenue/profit everywhere.** The stock
  delta formula in `apply_sale_stock_change()` (migration
  `003_add_order_status.sql` for `public`; baked into
  `provision_tenant_schema()` in `005_tenant_provisioning.sql` for every
  tenant schema including `tenant_kaufnest`) is
  `(status = 'returned' AND restock) ? 0 : -quantity`. If you add a new
  revenue/profit aggregation (in this page's `summary` or in
  `app/dashboard/page.tsx`'s StatCards/charts), filter out
  `status === "returned"` rows first (`page.tsx` does this inline in the
  `summary` useMemo; Overview uses an `effectiveSales` array) — otherwise
  written-off/returned orders will inflate those figures.
- The UI says "Orders" everywhere (page title, Sidebar, modal titles, toast
  messages) but the route, table, type, and slice all stay "sales" — don't
  rename files/exports when making more "Orders"-flavored UI tweaks.
- The "Search" box in `FilterBar` matches `product_name`, `external_order_id`,
  and `description` via a Supabase `.or()`/`ilike` clause (see
  `fetchSalesPage` in `_store/salesSlice.ts`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`) before being embedded —
  don't build the `.or()` string from a raw, unsanitized value. `handleExport`
  mirrors the same predicate; keep both in sync if the column set ever changes.
