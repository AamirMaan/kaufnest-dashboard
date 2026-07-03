---
name: audit-logs-feature
description: Work on the Audit Logs dashboard feature (activity trail viewer) at src/app/dashboard/audit-logs, or on the shared auditLogsSlice that every other feature writes to — use when the task mentions audit logs, activity history, or compliance trail.
---

# Working on the Audit Logs feature

Read `CLAUDE.md` in this folder first. The key thing to internalize: **the page
is colocated here, but the Redux slice (`auditLogsSlice`) is shared** in
`src/store/slices/` because Sales/Expenses/Purchases/Users all dispatch
`addAuditLog` when they write records.

## Minimal file set for common changes

- **Change how a log entry is displayed**: `_components/AuditLogDetailModal.tsx`
  (detail view) or `page.tsx` (table row).
- **Add a new audit action or entity type**: `src/types/index.ts`
  (`AuditAction`/`AuditEntityType`), `src/store/slices/auditLogsSlice.ts` +
  its test, then grep for `writeAuditLog`/`addAuditLog` to update every feature
  that records that action.
- **Change what gets logged for an existing feature**: go to that feature's
  folder (e.g. `app/dashboard/sales/_components/AddSaleModal.tsx`), not here.
- **Add/change filters on the audit-logs page**: `src/lib/utils/filters.ts`
  (`AuditLogFilters`, `DEFAULT_AUDIT_LOG_FILTERS`, `isDefaultAuditLogFilters`),
  `src/store/slices/auditLogsSlice.ts` (thunk filter predicates), then
  `page.tsx` (UI controls).
- **Change page size or sort order**: `src/store/slices/auditLogsSlice.ts`
  (thunk `.order()` call) + `src/app/dashboard/layout.tsx` (initial `.range()`).

## Pagination data flow

Server-side pagination is active. `page.tsx` does **not** filter in memory —
all filtering happens in `fetchAuditLogsPage` (the thunk in
`src/store/slices/auditLogsSlice.ts`). The flow for a filter change or page
navigation is:

1. User changes a filter or clicks Prev/Next in `<Pagination>`.
2. `page.tsx` dispatches `fetchAuditLogsPage({ page, pageSize, filters })`.
3. The thunk builds a Supabase query with filter predicates +
   `.select("*", { count: "exact" })` + `.order("created_at", { ascending: false })`
   + `.range(from, to)`, then dispatches `hydratePage` on success.
4. `state.auditLogs.items` is replaced with the new page; `total` holds the
   full count; `isFetching` goes back to `false`.
5. The initial hydration (`StoreProvider`) calls `hydratePage` (aliased as
   `hydrateAuditLogs`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.

`addAuditLog` (dispatched by CRUD features after mutations) prepends the new
entry and increments `total` — no refetch needed for live entries.

## Test command

`npx jest auditLogsSlice` (slice lives in `src/store/slices/`, not this folder)

## Gotchas

- Don't move `auditLogsSlice` into this folder — it would break the import in
  every other CRUD feature and central store registration (`src/store/store.ts`,
  `src/store/StoreProvider.tsx`).
- This is the compliance/audit trail for a bookkeeping app — be conservative
  about changing what gets recorded or how it's displayed.
- `audit_logs` uses `created_at` for date filtering (not a separate `date`
  column like sales/expenses/purchases). The thunk appends `T23:59:59.999Z` to
  the upper bound of the date range to be inclusive of the full day in UTC.
- `StoreProvider` now receives `auditLogs: { data: AuditLog[], count: number }`
  (object shape, same as sales/expenses/purchases). Passing a bare array will
  cause a TypeScript error.
- `isDefaultAuditLogFilters` is a separate export from `isDefaultFilters` —
  it handles the `action`/`user_id` fields that `isDefaultFilters` doesn't
  know about.
