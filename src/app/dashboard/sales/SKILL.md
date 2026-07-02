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
  formula changes also touch `_components/orderMath.ts` + its test.
- **Wire the Download Invoice button** (Phase 5 — DONE): `[id]/page.tsx` — the
  button now calls `handleDownloadInvoice()` which calls `generateOrderInvoice(sale,
  companyProfile)` from `@/lib/utils/generateInvoice`. `companyProfile` is read from
  `useAppSelector((s) => s.companyProfile.profile)` (hydrated by the dashboard
  layout). Button stays disabled only while `companyProfile` is null.

- **Add/change a field on a sale**: `_components/AddSaleModal.tsx` (create form),
  `_components/EditSaleModal.tsx` (edit form + before/after audit diff),
  `_store/salesSlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Sale` type. Also check `page.tsx` if the field
  needs to render in the table or be filterable (`lib/utils/filters.ts`).
  **Also update `ImportSalesModal.tsx`** if the new field is required or needs
  validation — add it to the `validateRow` function and `TEMPLATE_HEADERS`.
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
- **Change import validation / accepted columns**: `validateRow()` in
  `_components/ImportSalesModal.tsx` only.

## Test command

`npx jest dashboard/sales` — runs `_store/salesSlice.test.ts` and
`_components/orderMath.test.ts` (and any other `*.test.ts` colocated here).

## Gotchas — fee fields

- `shipping_cost`, `shipping_charged`, `advertising_fee` are all `number | null`.
  Empty string in form state → `null` before the DB write (never `0`). This is the
  same pattern as `vat_rate`/`vat_amount`.
- `EditSaleModal` auto-opens the "Fees & shipping" section when the existing sale has
  at least one fee non-null (checked in the `showFees` initializer).
- `validateRow()` in `ImportSalesModal` is now exported so it can be unit-tested in
  `ImportSalesModal.test.ts` alongside `productOptions.test.ts` / `orderStatus.test.ts`.
- The table "Fees" column sums `shipping_cost + advertising_fee` (seller costs);
  `shipping_charged` is not in the computed sum — it's the buyer-facing amount and
  appears only in the CSV export.

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
