# Audit Logs feature

Route: `/dashboard/audit-logs`. Read-only view of the full activity trail —
every create/update/delete/login/logout/role-change across the app.

## Files in this folder

- `page.tsx` — table of log entries with server-side pagination and filters
  (`FilterBar` for date preset/range, action type dropdown). Dispatches
  `fetchAuditLogsPage` on filter changes and page navigation. Shows a
  `<Pagination>` component and a loading opacity overlay while fetching.
  Opens the detail modal on row "View" click.
- `_components/AuditLogDetailModal.tsx` — renders a single log entry's metadata
  (e.g. before/after diffs for edits) in a readable layout.

## Important: the slice lives elsewhere — on purpose

Unlike Sales/Expenses/Purchases/Users, **`auditLogsSlice` is NOT colocated here**.
It lives in `src/store/slices/auditLogsSlice.ts` (+ `auditLogsSlice.test.ts`)
because every other CRUD feature dispatches `addAuditLog` directly when it
writes a record — it's shared cross-cutting state, not private to this page.
(This is the "3+ features" shared-code rule from `AGENTS.md` → "Shared vs. feature-private".)
If you need to change the log shape or add a new action/entity type, start in
`src/store/slices/auditLogsSlice.ts` and `src/types/index.ts` (`AuditLog`,
`AuditAction`, `AuditEntityType`), then check every feature that calls
`writeAuditLog`/`addAuditLog` (grep for `addAuditLog`).

## Shared dependencies

- `components/ui/{DataTable,Badge(ActionBadge),Button,FilterBar,Pagination}`
- `store/slices/auditLogsSlice` (shared — see above; exports `fetchAuditLogsPage`)
- `lib/utils/date` (`formatDateTime`)
- `lib/utils/filters` (`AuditLogFilters`, `DEFAULT_AUDIT_LOG_FILTERS`, `isDefaultAuditLogFilters`)
- `types` (`AuditLog`, `AuditAction`)

## Tests

Slice tests live at `src/store/slices/auditLogsSlice.test.ts` — run with
`npx jest auditLogsSlice`. Tests cover pagination state (`hydratePage`,
`setFetching`, `addAuditLog` total arithmetic) and the `hydrateAuditLogs` alias.
