# Sales feature

Route: `/dashboard/sales`. Lists sales records (per platform: Amazon, eBay, Etsy,
Shopify, other), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: filtering (`FilterBar` + `filterSales`), row selection,
  invoice trigger, wires up the modals below.
- `_store/salesSlice.ts` — Redux slice for `state.sales` (`items`, `loaded`).
  Actions: `hydrateSales`, `addSale`, `updateSale`, `removeSale`. Used **only** by
  this feature — registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/salesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/sales`.
- `_components/AddSaleModal.tsx` / `EditSaleModal.tsx` — create/edit forms.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`createClient()` from `@/lib/supabase/client`, table `sales`).
2. On success, dispatch the local slice action (`addSale`/`updateSale`/`removeSale`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) to persist an audit row, then dispatch
   `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it immediately in the
   shared audit log state.

`EditSaleModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields`, `DataTable`, `FilterBar`,
  `Badge` (`PlatformBadge`), `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Expenses and
  Purchases (don't fork these; extend them if you need new shared behavior)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `lib/utils/{audit,currency,date,filters,generateInvoice}`, `lib/hooks/useInvoiceSettings`
- `types` (`Sale`, `Platform`, `Currency`)

## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
