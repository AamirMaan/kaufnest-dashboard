# Purchases feature

Route: `/dashboard/purchases`. Lists inventory purchase records (product, vendor,
quantity, unit price), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset, currency, general keyword search across product
  name/vendor/description), `<Pagination>`, loading overlay, Gross/VAT/Net
  summary **(this page)**, **Export CSV** button (server-side query, no
  `.range()`, capped at 5 000 rows), **Import CSV** button, wires up the
  modals below.
- `_store/purchasesSlice.ts` — Redux slice for `state.purchases` (`items`,
  `loaded`, `page`, `pageSize`, `total`, `isFetching`).
  Actions: `hydratePage` (also exported as `hydratePurchases` for `StoreProvider`),
  `addPurchase`, `updatePurchase`, `removePurchase`, `setFetching`.
  Thunk: `fetchPurchasesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, currency, and a keyword `search` matched
  via `.or()`/`ilike` across `product_name`/`vendor`/`description`, sanitized
  with `sanitizeIlikeSearchTerm`), `.select("*", { count: "exact" })`,
  `.order("date")`, and `.range(from, to)` from `rangeFor()`. There is no
  standalone vendor filter — the general search box covers vendor.
  Used **only** by this feature — registered centrally in `src/store/store.ts`
  and hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/purchasesSlice.test.ts` — reducer tests (covers `hydratePurchases`,
  `addPurchase`/`removePurchase` total arithmetic, `fetchPurchasesPage`
  pending/fulfilled/rejected cases). Run with `npx jest dashboard/purchases`.
- `_components/AddPurchaseModal.tsx` / `EditPurchaseModal.tsx` — create/edit forms.
- `_components/ImportPurchasesModal.tsx` — bulk CSV import: same pattern as
  `ImportSalesModal` but for purchases. See "CSV import/export" below.

## Pagination data flow

Server-side pagination is active. `page.tsx` **does not apply `filterPurchases`
in memory** — all filtering happens in `fetchPurchasesPage` (the thunk in
`_store/purchasesSlice.ts`). The flow for a filter change or page navigation is:

1. User changes a filter or clicks Prev/Next in `<Pagination>`.
2. `page.tsx` dispatches `fetchPurchasesPage({ page, pageSize, filters })`.
3. The thunk builds a Supabase query with filter predicates + `.select("*", { count: "exact" })` + `.range(from, to)`, then dispatches `hydratePage({ data, count, page, pageSize })` on success.
4. `state.purchases.items` is replaced with the new page; `total` holds the full
   count across all pages; `isFetching` goes back to `false`.
5. The initial hydration (`StoreProvider`) calls `hydratePage` too (aliased as
   `hydratePurchases`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.

**Summary cards** show "(this page)" totals only — computed from
`state.purchases.items` (current page). Clearly labelled in the UI.

**CSV export** (`handleExport`) bypasses Redux and runs a fresh Supabase query
with the same filter predicates but **no `.range()`**, capped at 5 000 rows.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`await createTenantClient()` from `@/lib/supabase/client`, table `purchases`).
2. On success, dispatch the local slice action (`addPurchase`/`updatePurchase`/`removePurchase`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) to persist an audit row, then dispatch
   `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it immediately in the
   shared audit log state.

`EditPurchaseModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## Inventory link + VAT (additive fields on `Purchase`)

- `product_id: string | null` — optional FK to `products` (Inventory feature).
  Both modals render an "Inventory Product" `Select` sourced from
  `useAppSelector((s) => s.inventory.items)`; selecting one is enough — a DB
  trigger (`purchases_stock_change`, see `supabase/migrations/002_inventory_and_vat.sql`)
  increments `products.current_stock` automatically. **Don't add client-side
  stock math.**
- `vat_rate`/`vat_amount: number | null` — populated when the user checks
  "Total includes VAT" (a `Checkbox` from `FormFields`). The rate defaults to
  `companyProfile.profile?.vat_rate` (per-tenant default from
  `store/slices/companyProfileSlice`, falls back to `19`) but is editable
  per-record (e.g. reduced 7% rate on some goods); the amount is extracted from
  the gross total via
  `vatAmountFromGross` (`lib/utils/currency`). Both stay `null` when the toggle
  is off — `total_amount` (generated column) remains the gross/paid figure
  either way.

## Sale link (`sale_id`)

`sale_id: string | null` — when non-null, this purchase was created as the cost-of-goods record for a specific sale. The purchases list renders a "Linked to order →" link below the product name for these rows (navigates to `/dashboard/sales/{sale_id}`). The FK is `ON DELETE SET NULL` — if the linked sale is deleted, the purchase survives with `sale_id` reset to `null`.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields` (incl. `Checkbox`),
  `DataTable`, `FilterBar`, `Pagination`, `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Sales and
  Expenses (don't fork these; extend them if you need new shared behavior)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `app/dashboard/inventory/_store/inventorySlice` — read-only here, for the
  product-link `Select` (`s.inventory.items`)
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv,pagedQuery}`, `store/slices/companyProfileSlice`
- `types` (`Purchase`, `Product`)

## CSV import/export

**Export**: `handleExport()` in `page.tsx` runs a fresh Supabase query with the
same filter predicates (no `.range()`, capped at 5 000 rows) and calls
`exportToCsv`. Columns: `date, product_name, vendor, quantity, unit_price,
total_amount, currency, vat_rate, vat_amount, description`.

**Import** (`ImportPurchasesModal`): Required: `date` (YYYY-MM-DD),
`product_name`, `quantity`, `unit_price`. Optional: `vendor`, `currency`
(default EUR), `vat_rate`, `description`. `product_id` is NOT in the import
format. `total_amount` and `vat_amount` are computed. All rows must be valid;
one audit log entry for the batch (omit `entityId`).

## Tests

`npx jest dashboard/purchases` runs `_store/purchasesSlice.test.ts`.
