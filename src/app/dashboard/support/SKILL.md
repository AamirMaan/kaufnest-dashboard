---
name: support-feature
description: Work on the in-app support/bug-tracker feature (report a bug, the tenant board, Trello sync) at src/app/dashboard/support and src/lib/support — use when the task mentions support, bug reports, the bug tracker, Trello cards, or the /dashboard/support route.
---

# Working on the Support / bug tracker feature

Read `CLAUDE.md` in this folder first — it explains the file map and the two
data flows (submit/read, and webhook → notification). This feature's data
lives in the **control plane** (Project A), not a tenant schema, which is
the source of most of the gotchas below. The platform-admin counterpart
(`/admin/support`) has its own `SKILL.md` at `src/app/admin/` — this one is
scoped to the tenant-facing board and the shared `src/lib/support/` library.

## Minimal file set for common changes

- **Add/change a field on the report form**: `_components/ReportIssueModal.tsx`
  (form state + `FormData` fields), `src/app/api/support/report/route.ts`
  (validates and inserts the field), `supabase/control-plane/011_bug_reports.sql`
  (column), `src/types/index.ts` (`BugReport`). If the field should appear on
  the Trello card, also touch `src/lib/support/cardContent.ts`
  (`renderCardDescription`).
- **Change attachment limits (count/size/mime types)**:
  `_lib/attachmentRules.ts` only — both the modal and the two attachment
  routes (`src/app/api/support/report/route.ts`,
  `src/app/api/support/reports/[id]/attachments/route.ts`) import
  `validateAttachments`/`MAX_FILES`/`MAX_TOTAL_BYTES`/`ALLOWED_MIME_TYPES`
  from here — there is nowhere else to change the rule. See gotcha 6 before
  raising the byte cap.
- **Change board columns/status labels**: `_lib/groupReports.ts`
  (`STATUS_COLUMNS`, `STATUS_LABELS`, `STATUS_EMPTY_MESSAGES`). If you add a
  new `BugReportStatus`, also update: `src/types/index.ts`
  (`BugReportStatus`), the CHECK constraint in
  `supabase/control-plane/011_bug_reports.sql`, `src/lib/support/config.ts`'s
  `KNOWN_STATUSES`, and the Trello list ↔ status mapping documented in
  `.env.local.example`'s `TRELLO_LIST_STATUS_MAP`.
- **Change what the Trello card looks like**: `src/lib/support/cardContent.ts`
  (`renderCardTitle`, `renderCardDescription`) only — both API routes that
  create/read cards (`report/route.ts`, `resync/route.ts`) call through
  these, never build the string inline.
- **Change the customer-reply marker or how a Trello comment maps to a
  reply**: `src/lib/support/cardContent.ts` (`parseCustomerReply`,
  `CUSTOMER_MARKER`) and `src/lib/support/webhookActions.ts`
  (`interpretAction`) — the webhook route only orchestrates, it doesn't
  parse.
- **Change list → status mapping**: `src/lib/support/config.ts`
  (`statusForList`, `parseStatusMap`, `FALLBACK_STATUS`) — used by both the
  webhook route (real-time) and `src/app/api/support/resync/route.ts`
  (the admin-triggered sweep).
- **Change the webhook signature scheme**: `src/lib/support/signature.ts`
  (`verifyWebhookSignature`) — see gotcha 3 before touching the signed
  material.
- **Change what triggers a bell notification, or its copy**:
  `src/lib/support/notify.ts` (`notifyReporter`) — see gotcha 4 before
  changing `actor_id`.
- **Add a new Trello webhook action type to handle**:
  `src/lib/support/webhookActions.ts`'s `interpretAction` — add a new
  `InterpretedAction` variant, then handle it in
  `src/app/api/support/trello-webhook/route.ts`'s `if (interpreted.kind ===
  ...)` chain. Anything not explicitly handled must stay `{ kind: "ignore" }`
  — Trello sends far more action types than this feature cares about.
- **Register/re-register the Trello webhook**: run
  `node scripts/support/register-trello-webhook.mjs` against a **deployed**
  URL (Trello HEADs the callback during registration — localhost will not
  work). Re-run it any time `TRELLO_WEBHOOK_CALLBACK_URL` changes — see
  gotcha 3.

## Test command

`npx jest src/lib/support src/app/dashboard/support` — runs every colocated
`*.test.ts` in both the shared library and this feature folder.

## Gotchas

1. **Bug reports live in the control plane, so there is no RLS on them** —
   every read path must filter by `tenant_id` explicitly (both
   `src/app/api/support/reports/route.ts` and the two attachment routes do
   this via `assertReportVisible()` in `src/lib/support/authorizeReport.ts`).
   An id belonging to another tenant answers **404**, never 403 — a 403
   would itself confirm the id exists. Don't "simplify" a 404 into a 403 if
   you touch these routes.
2. **Trello attachment downloads reject `key`/`token` query params.** Every
   other Trello endpoint this app calls (`createCard`, `attachFile`,
   `fetchCard`) authenticates via `?key=…&token=…` in the URL —
   `downloadAttachment` (`src/lib/support/trello.ts`) is the one exception
   and needs the credentials in an `Authorization: OAuth
   oauth_consumer_key="…", oauth_token="…"` header instead, or Trello
   answers 401. Don't "simplify" it to match the other three calls.
3. **The webhook signature covers `body + callbackURL`, not just the
   body.** `verifyWebhookSignature` (`src/lib/support/signature.ts`) HMACs
   `rawBody + callbackUrl`. Changing `TRELLO_WEBHOOK_CALLBACK_URL` (a
   redeploy to a new domain, a path rename) without re-registering the
   webhook via `scripts/support/register-trello-webhook.mjs` silently
   breaks every delivery with a 401 — Trello signed against the OLD URL,
   this app verifies against the NEW one.
4. **`actor_id` must be null on support notifications.**
   `notifyReporter()` (`src/lib/support/notify.ts`) always inserts with
   `actor_id: null`. `isUnread()` (the shared notifications helper) treats
   a notification whose `actor_id` matches the current viewer as
   self-caused and suppresses it — but the "actor" of a Trello status
   change or reply is the Boughtopia support team, external to the tenant,
   not the reporter. Stamping the reporter's own id would hide the update
   from the one person who asked for it.
5. **`trello_comment_id` is `unique`** (`bug_report_replies`,
   `supabase/control-plane/011_bug_reports.sql`), and Trello redelivers
   webhook actions. A `23505` (unique violation) on the reply insert in
   `src/app/api/support/trello-webhook/route.ts` means "Trello replayed
   this comment" — the route returns `{ ok: true }` (200), not an error.
   Treating a 23505 as a failure would make Trello retry forever on a
   comment that already landed.
6. **The 4 MB attachment cap (`MAX_TOTAL_BYTES`,
   `_lib/attachmentRules.ts`) is Vercel's 4.5 MB serverless request-body
   limit, not a product preference.** The screenshot form posts files
   inline as multipart, so the whole request — title/description/files —
   has to fit under that ceiling. Raising the cap means building a chunked
   or direct-to-Trello upload path, not just changing the constant.
7. **Screenshots exist only on Trello — this app never stores the file
   itself.** `bug_reports.attachments` (jsonb) is metadata only (id/name/
   mime/bytes); the actual bytes live on the Trello card and are proxied
   on read via `downloadAttachment`. Deleting the Trello card (or the board)
   deletes the customer's evidence permanently — there is no local backup
   to fall back to.

## Gotchas — beyond the seven above

- **Trello failure never fails the report.** `POST /api/support/report`
  inserts the `bug_reports` row FIRST, then best-effort creates the card —
  a Trello outage still returns 201 with a `warning` string
  (`ReportIssueModal` shows it via `toast.warning`). A report with
  `trello_card_id: null` is an orphan the support team can't see on the
  board; there's no automatic retry — see the resync route below.
- **The admin resync route (`POST /api/support/resync`) is the only repair
  path for a missed webhook or a dropped card creation** — it walks up to
  200 non-`wont_fix` reports that DO have a `trello_card_id`, and doesn't
  even try to fix orphans (`trello_card_id: null`, from the point above).
  It's triggered manually from `/admin/support`, not on a schedule.
- **`ReportDetailPanel` never talks to Trello directly** — attachment
  `<img>` tags point at this app's own
  `/api/support/reports/[id]/attachments/[attachmentId]` proxy route, which
  authorizes the tenant, then calls `downloadAttachment` server-side and
  streams the bytes back. A raw Trello attachment URL would either need
  Trello credentials in the browser (never do this) or be a private URL the
  browser can't reach anyway.
- **`page.tsx` has no pagination** — `fetchReports()` returns every report
  for the tenant in one call. This is deliberate (support-report volume per
  tenant is expected to stay low), not an oversight to "fix" by porting in
  the `pagedQuery`/`DEFAULT_PAGE_SIZE` pattern other features use.
