# Support / bug tracker feature

Route: `/dashboard/support`. Every role, every plan — this is the one feature
with no role/plan gate at all. Lets a tenant user report a bug, feature
request, or question; the report becomes a Trello card behind the scenes, and
the page shows a four-column board (Reported / In Progress / Fixed / Won't
Fix) of that tenant's own reports, with a detail panel for description,
screenshots, and Trello-comment replies. The platform-admin counterpart (a
cross-tenant inbox at `/admin/support`) is a **separate** feature, documented
in `src/app/admin/CLAUDE.md`/`SKILL.md` — this file only covers the
tenant-facing folder and the shared `src/lib/support/` library both sides
depend on.

## Files in this folder

- `page.tsx` — the board. On mount, dispatches `fetchReports()`. Renders a
  4-column grid (`md:grid-cols-4`, one per `BugReportStatus`) above `md`, and
  a single filtered list behind a status `<select>` below it (same
  desktop-grid/mobile-select pattern as other list pages). Each column/list
  is built by `groupByStatus()` from `_lib/groupReports.ts`. Clicking a
  `ReportCard` dispatches `selectReport(report.id)`, which opens
  `ReportDetailPanel`. A "Report an issue" `Button` in the `PageHeader`
  opens `ReportIssueModal`, passing the current `pathname` as `pageUrl`
  context for the card. No `_components`/`_store` state beyond what's listed
  below — no pagination (tenant-scoped bug report volume is low; all reports
  for the tenant are fetched in one call).
- `_components/ReportCard.tsx` — one board-column entry: title, a type
  `Badge`, a severity `Badge` (color-mapped: critical→danger, high→warning,
  normal→info, low→default), an attachment count, and
  `reporter_email · date [· N reply]`. Pure presentational, `onOpen` callback.
- `_components/ReportDetailPanel.tsx` — a `Modal` showing the full report:
  type/severity/status badges, description, a `context` key/value block (the
  plan/tenant_slug/user_agent snapshot captured at submit time — see "Data
  flow" below), an attachment image grid (each `<img>` points at
  `/api/support/reports/[id]/attachments/[attachmentId]`, which proxies the
  Trello download server-side — see "Shared deps" below for why this can't
  be a direct Trello URL), and an "Updates" thread rendering `report.replies`
  (customer-visible Trello comments only — see `src/lib/support/cardContent.ts`'s
  `@customer` marker). Read-only; no edit/delete UI, since the source of
  truth for triage is the Trello card, not this page.
- `_components/ReportIssueModal.tsx` — the "Report an issue" form: Title,
  Description (≥20 chars), Type/Severity `Select`s, and an optional
  multi-file Screenshots `Input` (validated client-side via
  `_lib/attachmentRules.ts` as the user picks files, so `fileError` blocks
  submission before the network round-trip). Follows this repo's mandatory
  form conventions — real `<form id="report-issue-form">`, every `required`
  `Field` has a matching `required` attribute on its control, submit button
  is `type="submit" form="report-issue-form"` living in the `Modal` footer,
  `disabled={saving || !isFormValid}`, busy label ("Sending…") while
  in-flight. On submit, builds a `FormData` (title/description/type/severity/
  pageUrl + one `files` entry per screenshot) and dispatches `submitReport`;
  success re-dispatches `fetchReports()` so the new card's server-assigned
  fields (id, `trello_card_id`, etc.) land in Redux instead of relying on the
  thunk's own optimistic return.
- `_lib/attachmentRules.ts` (+ colocated `.test.ts`) — pure, dependency-free
  validation shared by the modal (client) and both attachment routes
  (server): `MAX_FILES = 3`, `MAX_TOTAL_BYTES` (4 MB), `ALLOWED_MIME_TYPES`
  (png/jpeg/webp/gif), `validateAttachments(files) → string | null`. The one
  module in this feature imported from both sides of the client/server
  boundary — see the SKILL.md gotcha for why the byte cap is fixed, not a
  preference.
- `_lib/groupReports.ts` (+ colocated `.test.ts`) — pure board-layout helpers:
  `STATUS_COLUMNS` (left-to-right order), `STATUS_LABELS`, `STATUS_EMPTY_MESSAGES`,
  and `groupByStatus(reports) → Record<BugReportStatus, BugReport[]>` (buckets
  and sorts each column newest-first; an unrecognized status falls back to
  the `reported` bucket rather than being dropped).
- `_store/supportSlice.ts` (+ colocated `.test.ts`) — Redux slice for
  `state.support` (`items`, `loaded`, `isFetching`, `isSubmitting`,
  `selectedId`, `error`). Thunks: `fetchReports()` (`GET
  /api/support/reports`) and `submitReport(form: FormData)` (`POST
  /api/support/report`, multipart). Reducer action: `selectReport(id |
  null)`. Both thunks talk to the app's own API routes, never Supabase
  directly — see "Data flow" below for why. Registered centrally in
  `src/store/store.ts`; **not** hydrated by `dashboard/layout.tsx` like the
  paginated collections (sales/expenses/…) — `page.tsx` fetches on its own
  mount, same as `NotificationBell` does for `notificationsSlice`.

## Data flow

This feature's data lives in the **control plane** (Project A), not the
tenant schema, so it does not follow the Supabase-write → slice-update →
audit-log pattern every other dashboard feature uses. Two separate flows:

**Submit → read (tenant browser → control plane):**
1. `ReportIssueModal` dispatches `submitReport(formData)` →
   `POST /api/support/report`.
2. The route resolves the caller's tenant from
   `user.app_metadata.tenant_schema` (never trusts a client-supplied tenant
   id), inserts a `control.bug_reports` row **first** — the report must
   survive a Trello outage — then best-effort creates the Trello card and
   uploads any screenshots as card attachments, patching
   `trello_card_id`/`trello_card_url`/`attachments` onto the same row. A
   Trello failure at this stage doesn't fail the request; it returns the
   saved report plus a `warning` string, which the modal surfaces via
   `toast.warning(...)` instead of `toast.success(...)`.
2. `page.tsx`/`fetchReports()` → `GET /api/support/reports` — resolves the
   same tenant, reads `control.bug_reports` filtered to that `tenant_id`,
   joins in `control.bug_report_replies` via `attachReplies()`
   (`src/lib/support/authorizeReport.ts`), and returns the list. The browser
   never talks to the control plane directly — it's a separate Supabase
   project the client has no credentials for.

**Webhook → control plane → tenant notification (Trello → this app, no
tenant browser involved):** Trello POSTs `updateCard`/`commentCard` actions
to `/api/support/trello-webhook`. After signature verification (see the
SKILL.md gotcha), the route updates the matching `bug_reports.status` or
inserts a `bug_report_replies` row, then calls `notifyReporter()`
(`src/lib/support/notify.ts`), which writes a bell notification into the
**reporting tenant's own schema** via `createServiceClientForTenant()` —
this is the one place this feature touches a tenant schema at all. The next
time that tenant's browser polls `notificationsSlice`
(`NotificationBell`, 60s interval — see `dashboard/CLAUDE.md`) or reloads
`/dashboard/support`, the update is visible. There is no push/realtime path;
a status change or reply is only visible after the next poll/reload.

## Shared dependencies

- `src/lib/support/` — the Trello adapter and everything both this folder
  and the admin inbox depend on: `config.ts` (`trelloEnv`, `statusForList`,
  `parseStatusMap`), `cardContent.ts` (card title/description rendering,
  `parseCustomerReply`/`@customer` marker), `signature.ts`
  (`verifyWebhookSignature`), `trello.ts` (`createCard`, `attachFile`,
  `fetchCard`, `downloadAttachment` — the Trello REST wrapper),
  `tenantContext.ts` (`tenantContextFrom`), `authorizeReport.ts`
  (`assertReportVisible`, `attachReplies`), `webhookActions.ts`
  (`interpretAction` — the Trello action → domain-event mapper),
  `notify.ts` (`notifyReporter`). All server-only — never imported from a
  `"use client"` file. See its own tests
  (`src/lib/support/*.test.ts`) for the contract each function guarantees.
- `components/ui/{Modal,Badge,Toast}` — `Modal` backs both
  `ReportDetailPanel` and `ReportIssueModal`; `Badge` renders type/severity/
  status; `useToast()` reports submit success/warning/failure.
- `components/ui/FormFields` (`Field`, `Input`, `Select`, `Textarea`, `Row`) —
  `ReportIssueModal`'s form.
- `components/layout/PageHeader` — the page title/description/action row.
- `store/hooks` (`useAppDispatch`/`useAppSelector`) — standard Redux wiring.
- `src/types/index.ts` — `BugReport`, `BugReportReply`, `BugAttachment`,
  `BugReportType`, `BugSeverity`, `BugReportStatus` (single source of truth
  for the shape both this folder and `src/lib/support/` work with).
- **Not used here, unlike most other feature folders**: `DataTable` (a board
  of cards, not a table) and `DeleteConfirmModal` (no delete flow — see
  SKILL.md gotcha 7). `DataTable`/`FilterBar` ARE used by the admin inbox
  counterpart (`src/app/admin/support/`) — see its own `CLAUDE.md`.

## Tests

`npx jest src/lib/support src/app/dashboard/support` runs every test in both
the shared library and this feature folder (`_lib/*.test.ts`,
`_store/supportSlice.test.ts`, and `src/lib/support/*.test.ts`).
