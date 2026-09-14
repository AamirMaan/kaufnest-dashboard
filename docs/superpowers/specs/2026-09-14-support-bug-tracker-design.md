# Support & bug tracker — design

**Date:** 2026-09-14
**Status:** Approved, not yet implemented

## Problem

Tenant users who hit a bug have nowhere to report it inside the app, and no way
to see whether anything happened afterwards. Reports that do arrive (email, chat)
carry no context — no page URL, no plan, no browser — so every one costs a
round-trip before triage can start.

## Goal

A `/dashboard/support` page where any tenant user can report an issue, and where
their whole company can see the status of everything it has reported. Each report
becomes a card on Boughtopia's internal Trello board; card movement and
customer-visible replies flow back into the app.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Visibility | Tenant-scoped board; platform admins see all | Reports carry order IDs, customer names and screenshots — cross-tenant visibility would leak one customer's data to another |
| Status sync | Trello webhook, plus an admin-triggered resync | Board reads our own DB, so page loads stay fast and survive a Trello outage; resync heals missed deliveries |
| Report contents | Title, description, type, severity, screenshots, auto-captured context | The context is what makes a report triageable without a follow-up email |
| Placement | Sidebar item → `/dashboard/support` | Matches every other feature folder; discoverable at the moment a user hits a bug |
| Trello layout | One shared board; list ID → status map in env | No per-tenant board limits, no provisioning failure mode |
| Conversation | One-way: status + team replies marked `@customer` | Keeps your team working in Trello; in-app replies would be a messaging feature |
| Notifications | Bell notification on status change and reply | Users shouldn't have to poll a page to learn their bug was fixed |

## Data model — control plane (Project A)

A bug report is Boughtopia's data, not the tenant's: support needs one inbox
across all customers, and the Trello webhook arrives with no tenant JWT to
resolve. Both tables live in the `control` schema.

```sql
control.bug_reports
  id                uuid primary key default gen_random_uuid()
  tenant_id         uuid not null references control.tenants(id) on delete cascade
  reporter_user_id  uuid not null          -- auth user id; shown on the card and
                                           -- used to pick the notification's role visibility
  reporter_email    text not null
  type              text not null          -- bug | feature | question
  severity          text not null          -- low | normal | high | critical
  title             text not null
  description       text not null
  status            text not null default 'reported'
                                           -- reported | in_progress | fixed | wont_fix
  page_url          text
  context           jsonb                  -- plan, user agent, tenant slug, app version
  attachment_urls   text[] not null default '{}'
  trello_card_id    text
  trello_card_url   text
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()
  last_synced_at    timestamptz

control.bug_report_replies
  id                uuid primary key default gen_random_uuid()
  report_id         uuid not null references control.bug_reports(id) on delete cascade
  body              text not null
  author            text                   -- Trello member full name
  trello_comment_id text unique            -- idempotency key for webhook replays
  created_at        timestamptz not null default now()
```

Indexes: `(tenant_id, created_at desc)`, `(status)`, `(trello_card_id)`.

**Consequence:** control-plane tables are unreachable from the browser (AGENTS.md
rule 3 — `createControlClient` is server-only), so the board reads through an API
route rather than a direct Supabase query, exactly as `/api/billing/status` does.
In exchange, the admin view needs no cross-schema fan-out and the feature needs no
`run_on_all_tenant_schemas` DDL.

## Components

### `src/lib/support/trello.ts` — server-only adapter

Mirrors `src/lib/integrations/`'s shape and its never-import-client-side rule.

- `createCard({ title, description, labelIds })` → `POST /1/cards`
- `attachUrl(cardId, url)` → `POST /1/cards/{id}/attachments`
- `fetchCard(cardId)` → for resync
- `statusForList(listId)` → maps a Trello list ID to a user-facing status,
  falling back to `in_progress` for unknown lists so reorganising the board
  never breaks the customer view
- `verifyWebhookSignature(body, header)` → base64 HMAC-SHA1 of
  `body + callbackURL` keyed with `TRELLO_API_SECRET`
- `renderCardDescription(report)` → the markdown block written into the card

Config, all env, none in the DB:

```
TRELLO_API_KEY
TRELLO_API_TOKEN
TRELLO_API_SECRET
TRELLO_BOARD_ID
TRELLO_INTAKE_LIST_ID
TRELLO_LIST_STATUS_MAP    # JSON: {"<listId>":"reported", ...}
TRELLO_WEBHOOK_CALLBACK_URL
```

### `src/app/api/support/`

| Route | Method | Guard | Does |
| --- | --- | --- | --- |
| `report/route.ts` | POST | authenticated tenant user | Insert report, then create Trello card |
| `reports/route.ts` | GET | authenticated tenant user | List the caller's tenant's reports + replies |
| `trello-webhook/route.ts` | POST / HEAD | HMAC signature | Apply card moves and `@customer` comments |
| `resync/route.ts` | POST | platform admin | Re-pull cards for orphaned or stale reports |

### `src/app/dashboard/support/`

```
support/
  page.tsx
  _components/ReportIssueModal.tsx
  _components/ReportCard.tsx
  _components/ReportDetailPanel.tsx
  _store/supportSlice.ts + supportSlice.test.ts
  _lib/statusMap.ts + statusMap.test.ts
  _lib/groupReports.ts + groupReports.test.ts
  CLAUDE.md
  SKILL.md
```

### `src/app/admin/support/page.tsx`

The same data unfiltered: tenant column, status filter, a **Resync from Trello**
button, a link out to each card, and a flag on reports with a null
`trello_card_id`.

### Migrations

- Control plane: `control.bug_reports` + `control.bug_report_replies`.
- Project B: `045_support_attachments_bucket.sql` — public-read
  `support-attachments` bucket, path `{tenant_schema}/{uuid}/{filename}`,
  write restricted to authenticated members of the owning tenant. Same shape as
  `022_listing_images_bucket.sql`.

## Flows

### Submit

1. User opens *Report an issue* on `/dashboard/support`. The modal accepts an
   optional `pageUrl` prop so it can later be triggered from anywhere.
2. Screenshots upload client-side to `support-attachments` before submit —
   max 3 files, 5 MB each, images only.
3. `POST /api/support/report` resolves the user and `tenant_schema` from the
   session, looks up `tenants.id`/`slug`/`plan`, and **inserts the report first**
   with `status = 'reported'`.
4. It then creates the Trello card in `TRELLO_INTAKE_LIST_ID` (name = title,
   desc = rendered context block, `idLabels` = the tenant's label if mapped),
   attaches each screenshot by URL, and writes `trello_card_id`/`trello_card_url`
   back.

Steps 3–4 are wrapped: a Trello failure leaves `trello_card_id` null, returns
201 with a warning, and the report shows as orphaned in `/admin/support` until
resync picks it up. A support form that 500s because a third party is down is the
worst possible failure for a support form.

**Screenshots are public-read** so Trello can fetch them. URLs are unguessable
but not access-controlled; the upload field says so, because users will screenshot
order data.

### Webhook

`POST /api/support/trello-webhook`:

- Verify `x-trello-webhook` against the HMAC described above; 401 on mismatch.
- Answer `HEAD` with 200 — Trello requires this at registration time.
- `updateCard` with a list change → map the new list ID to a status, update the
  row, stamp `last_synced_at`.
- `commentCard` whose text starts with `@customer` → insert a reply with the
  marker stripped, keyed on `trello_comment_id` for replay safety. Comments
  without the marker are internal chatter and are ignored.
- Everything else → 200, no-op. Trello sends many event types.

### Notification

After a status change or a customer-visible reply, the webhook resolves
`tenant_schema` from `tenant_id` and inserts into that tenant's `notifications`
table using a Project B **service-role** client.

This is the one new pattern in the feature. `028_notifications.sql` states that
rows are written only by SECURITY DEFINER triggers and that there is deliberately
no insert policy for `authenticated`. The service key bypasses RLS, so the
invariant it protects — users cannot forge notifications — still holds.
`visible_to_roles` is the reporter's own role plus `admin` and `super_admin`;
`link` points at `/dashboard/support`.

### Webhook registration

A one-off script, `scripts/support/register-trello-webhook.mjs`, creates the board
webhook. Deliberately not a route, so nobody can trigger re-registration from the
app.

## UI

**Board.** Four status columns — Reported, In Progress, Fixed, Won't Fix — each a
list of cards showing title, type and severity badges, reporter, relative date and
reply count. Clicking a card opens a detail panel with the full description,
screenshots, captured context and the reply thread. Every column carries an
`emptyMessage`. At narrow widths the columns collapse to one list with a status
filter — four kanban columns on a phone is unusable.

Sidebar: a life-buoy `lucide-react` icon below Planner.

**Access.** Any authenticated tenant user can submit and can see their tenant's
board. No plan gating — support is not a paid feature — and no new permission;
gating the ability to report a bug is a bad trade.

**Form conventions**, per AGENTS.md:

- Real `<form id="report-issue-form" onSubmit={...}>`.
- `required` on both the `<Field>` label and the underlying control.
- Submit button `type="submit" form="report-issue-form"` in the modal footer.
- `disabled={saving || !isFormValid}` where `isFormValid` = title non-empty,
  description ≥ 20 characters, type and severity set, no upload in flight.
- Label swaps to "Sending…" while posting; toast on both success and failure.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Trello unreachable on submit | Report saved, warning toast, flagged orphan in `/admin/support`, healed by resync |
| Bad webhook signature | 401, nothing written |
| Unknown Trello list ID | Status falls back to `in_progress`, logged |
| Screenshot upload fails | Inline field error blocks submit — never silently dropped |
| Any Postgres error | Logged server-side; the client gets a sentence, never the raw error (verifier-enforced) |

## Tests

All pure and colocated:

- `_lib/statusMap.test.ts` — list ID → status, unknown-list fallback,
  `@customer` marker stripping.
- `_lib/groupReports.test.ts` — grouping and sorting into columns.
- `src/lib/support/trello.test.ts` — signature verification (valid, tampered
  body, wrong callback URL), card-description rendering.
- `_store/supportSlice.test.ts` — hydrate, optimistic add on submit, status
  update from a refetch.

Run with `npx jest dashboard/support` and `npx jest lib/support`.

## Docs to update in the same commit

- New `src/app/dashboard/support/CLAUDE.md` and `SKILL.md`.
- `AGENTS.md`: the new `src/lib/support/` shared module, and a note that
  `/api/support/trello-webhook` is a second unauthenticated-but-signed webhook
  alongside Stripe's.
- `.env.local.example`: the seven Trello variables.

## Out of scope for v1

Users replying in-app; voting and duplicate-merging; email notifications; SLA
timers; per-tenant Trello boards.
