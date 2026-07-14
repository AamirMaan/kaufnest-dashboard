---
name: purchases-feature
description: Work on the Purchases dashboard feature (list, add/edit/delete inventory purchase records, invoices) at src/app/dashboard/purchases — use when the task mentions purchases, inventory buys, vendors, or the /dashboard/purchases route.
---

# Working on the Purchases feature

This feature is fully colocated under `src/app/dashboard/purchases/`. Read
`CLAUDE.md` in this folder first — it explains the file map, the server-side
pagination data flow, and the Supabase-write → slice-update → audit-log pattern
every mutation follows.

## Minimal file set for common changes

- **Add/change a field on a purchase**: `_components/AddPurchaseModal.tsx`
  (create form), `_components/EditPurchaseModal.tsx` (edit form + before/after
  audit diff), `_store/purchasesSlice.ts` only if the shape stored in Redux
  changes, and `src/types/index.ts` for the `Purchase` type. Also check
  `page.tsx` if the field needs to render in the table or be filterable
  (`lib/utils/filters.ts`). **Also update `ImportPurchasesModal.tsx`** if the
  field needs import support.
- **Change list/filter/table behavior**: `page.tsx` only.
- **Change server-side filter pushdown**: `_store/purchasesSlice.ts`
  (`fetchPurchasesPage` thunk) + `page.tsx` (`handleExport` must mirror the same
  predicates).
- **Change reducer logic**: `_store/purchasesSlice.ts` + its test.
- **Change export columns**: `handleExport()` in `page.tsx`.
- **Change import validation / accepted columns**: `validateRow()` in
  `_components/ImportPurchasesModal.tsx` only.

## Test command

`npx jest dashboard/purchases`

## Gotchas

- `purchasesSlice` is registered centrally in `src/store/store.ts` and hydrated
  in `src/store/StoreProvider.tsx` — those two files import it via the
  `@/app/dashboard/purchases/_store/purchasesSlice` alias. If you rename the
  slice file, update those imports too.
- `hydratePurchases` is a re-export alias for `hydratePage` — `StoreProvider`
  calls `hydratePurchases({ data, count, page: 1, pageSize: DEFAULT_PAGE_SIZE })`.
  The old `hydrate(Purchase[])` signature is gone; always pass the full
  `{ data, count, page, pageSize }` shape.
- Summary cards in `page.tsx` are computed from `state.purchases.items` (current
  page only) and labelled "(this page)" — they are NOT all-time aggregates.
- The Export button queries Supabase directly with **no `.range()`** (capped at
  5 000 rows) so it always covers all matching records regardless of which page
  is shown. Mirror filter predicates from `fetchPurchasesPage` exactly.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Sales and Expenses
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
- `Purchase.product_id` is optional and FK's to `products` (Inventory feature) —
  the modals just set it via a `Select`; a DB trigger keeps `current_stock` in
  sync (purchases *increment* stock, sales decrement). Never write to
  `products.current_stock` from here.
- `Purchase.vat_rate`/`vat_amount` are populated only when "Total includes VAT"
  is checked (`Checkbox` + `vatAmountFromGross`); send `null` for both when
  it's off — see `CLAUDE.md` → "Inventory link + VAT" for the full pattern,
  which is identical across Purchases/Sales/Expenses modals.
- `writeAuditLog` `entityId` is `string | undefined` — omit it for bulk-import
  batch entries rather than passing `null` (which is a TypeScript error).
- There is no standalone vendor filter (removed — the general "Search" box
  covers it). Search matches `product_name`, `vendor`, and `description` via
  `.or()`/`ilike` (see `fetchPurchasesPage`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`). `handleExport` mirrors
  the same predicate — keep both in sync if the column set ever changes.
