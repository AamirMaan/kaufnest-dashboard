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

## Test command

`npx jest auditLogsSlice` (slice lives in `src/store/slices/`, not this folder)

## Gotchas

- Don't move `auditLogsSlice` into this folder — it would break the import in
  every other CRUD feature and central store registration (`src/store/store.ts`,
  `src/store/StoreProvider.tsx`).
- This is the compliance/audit trail for a bookkeeping app — be conservative
  about changing what gets recorded or how it's displayed.
