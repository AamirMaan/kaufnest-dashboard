# Location dispatchers & dispatch notifications — design

**Date:** 2026-10-19
**Status:** Approved (brainstorming), awaiting implementation plan
**Plan gating:** Business plan only — requires Advanced Inventory (`inventory_settings.advanced_enabled`), since stock locations only exist there (migration 047).

## Problem

Orders arrive (manually or via eBay/Amazon sync) and get linked to an
inventory product and a fulfillment location, but nobody is told that a
specific warehouse now has an order to ship. We want each warehouse location
to have a responsible person who is emailed and shown a dashboard banner when
an order lands on their location.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| When does the dispatcher get notified? | The first moment an order row has **both** `product_id` and `fulfillment_location_id` set — whichever is set last. Covers manual orders created with a product and synced orders once a product is linked in Edit Sale. |
| Users per location | **One** dispatcher per location (nullable). |
| Banner | **Persistent**, dispatcher-only, live count of open orders per location; disappears on its own once the orders leave an open status. Plus one bell notification per order. |
| Email transport | **SMTP via nodemailer** — the Mailgun SMTP account already used by Supabase auth, sender `noreply@mg.boughtopia.com`. |
| Detection architecture | **DB trigger + outbox**, drained by a server API route. |

Rejected: API-route-only detection (any write path that forgets to call it
silently skips the notification); `pg_net` webhook (extension, public URL and
shared secret per environment, hard to test locally).

## Data model

New migration `supabase/migrations/057_location_dispatchers.sql`, all tenant
DDL via `public.run_on_all_tenant_schemas`, and the same DDL added to
`provision_tenant_schema()` in `005_tenant_provisioning.sql` (2-places rule —
see `supabase/SKILL.md`). Because stock-location tables are only created by
`install_advanced_inventory` (047), the 057 DDL is guarded the same way 047's
dependants are: skip a schema whose `stock_locations` table does not exist,
and add the columns inside the advanced-inventory installer too so tenants
enabling it later get them.

### Changed tables

- `stock_locations.dispatcher_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL`
- `sales.dispatch_notified_at timestamptz NULL` — once-only flag, written only by the trigger.
- `notifications.recipient_user_id uuid NULL REFERENCES profiles(id) ON DELETE CASCADE`
  - Index on `(recipient_user_id, created_at desc)`.
  - `notifications_select` policy (current definition is 055's) is recreated
    with an extra disjunct: `OR recipient_user_id = auth.uid()`.
    `is_tenant_member()` still required.
  - Dispatch notifications set `visible_to_roles = '{}'` and
    `required_permission = NULL`, so only the recipient matches.

### New table `dispatch_email_outbox`

| column | type |
| --- | --- |
| `id` | uuid pk default `gen_random_uuid()` |
| `sale_id` | uuid not null → `sales(id)` on delete cascade |
| `recipient_user_id` | uuid not null → `profiles(id)` on delete cascade |
| `created_at` | timestamptz not null default now() |
| `claimed_at` | timestamptz null |
| `sent_at` | timestamptz null |
| `attempts` | int not null default 0 |
| `last_error` | text null |

Partial index on `(created_at) WHERE sent_at IS NULL`. RLS enabled with **no**
policies and no grants to `authenticated` — service role only.

### RPC `claim_dispatch_emails(p_limit int)`

`SECURITY DEFINER`, executable by `service_role` only. Atomically claims rows:
`UPDATE … SET claimed_at = now(), attempts = attempts + 1 WHERE id IN (SELECT id
… WHERE sent_at IS NULL AND attempts < 5 AND (claimed_at IS NULL OR claimed_at
< now() - interval '5 minutes') ORDER BY created_at LIMIT p_limit FOR UPDATE
SKIP LOCKED) RETURNING …`, joined to the sale (order fields, product name,
quantity, shipping address), the location name, and the recipient profile
(email, full name, status). Concurrent flushes therefore never double-send;
a crashed flush's claim expires after 5 minutes.

## Trigger

Two triggers, both `SECURITY DEFINER`, owned by the schema owner (same
pattern as 029's notification triggers). The flag is set on `NEW` in a BEFORE
trigger — **never** via a second `UPDATE sales` from an AFTER trigger, which
would re-fire 047's inventory-ledger triggers on `sales`.

**`sales_dispatch_flag` — `BEFORE INSERT OR UPDATE ON sales`:**

1. Clients cannot set the flag: on `INSERT`, force
   `NEW.dispatch_notified_at := NULL`; on `UPDATE`, start from
   `OLD.dispatch_notified_at` (ignore any client-supplied value).
2. On `UPDATE` where `fulfillment_location_id` changed **and** the old value
   was not null, reset `NEW.dispatch_notified_at := NULL` (the new
   warehouse's dispatcher must be told).
3. Set `NEW.dispatch_notified_at := now()` only if all hold:
   - `NEW.product_id IS NOT NULL`
   - `NEW.fulfillment_location_id IS NOT NULL`
   - `NEW.dispatch_notified_at IS NULL` (after steps 1–2)
   - `inventory_settings.advanced_enabled`
   - the location's `dispatcher_id` is set and that profile's status is active
   - `lower(NEW.status) IN ('pending', 'processing')`

**`sales_dispatch_notify` — `AFTER INSERT OR UPDATE ON sales`:** fires when
`NEW.dispatch_notified_at IS NOT NULL AND NEW.dispatch_notified_at IS
DISTINCT FROM OLD.dispatch_notified_at` (on INSERT: when non-null). It reads
the location's dispatcher and:
   - Inserts one `notifications` row: `type = 'inventory.dispatch_assigned'`,
     `category = 'inventory'`, `entity_type = 'sale'`, `entity_id = NEW.id`,
     `title = 'Order to dispatch from <location>'`, `body = '<qty> × <product name> — <platform> order <external/short id>'`,
     `link = '/dashboard/sales/<id>'`, `recipient_user_id = dispatcher`,
     `actor_id = auth.uid()` (null for service-role imports), `visible_to_roles = '{}'`.
   - Insert one `dispatch_email_outbox` row.

Decided behaviours:
- Unlinking and relinking the product does **not** re-notify (flag stays set).
- Moving the order to a different location **does** notify the new dispatcher.
- Assigning a dispatcher to a location with existing open orders sends **no**
  back-dated emails or notifications; the banner (live query) shows them.
- Changing a location's dispatcher later does not re-notify past orders; the
  banner follows the current dispatcher.
- The actor is the dispatcher themself (e.g. they linked the product): the
  bell row is still written, but `isUnread()` suppresses self-caused rows, so
  it won't show as unread. The email is still sent. Accepted.

## Email delivery

### `src/lib/email/` (server-only, `import "server-only"`)

- `smtp.ts` — lazily creates and caches a nodemailer transport from
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
  `isSmtpConfigured()` returns false if any is missing. New dependency:
  `nodemailer` + `@types/nodemailer`. Env vars added to `.env.local.example`.
- `dispatchEmail.ts` — pure `buildDispatchEmail({ order, locationName,
  recipientName, appUrl })` → `{ subject, html, text }`. Every interpolated
  value HTML-escaped. Subject: `Dispatch needed: <qty> × <product> (<location>)`.
  Body: product, quantity, platform/marketplace, order id, order date, buyer
  name and shipping address, and a button linking `<appUrl>/dashboard/sales/<id>`.

### `src/lib/dispatch/flushOutbox.ts` (server-only)

`flushDispatchOutbox(schema)`:
1. Return `{ sent: 0, failed: 0, skipped: true }` if SMTP is not configured
   (local/dev never break; rows stay pending).
2. `claim_dispatch_emails(50)` via `createServiceClientForTenant(schema)`.
3. For each row: if recipient inactive/missing email or sale gone → mark
   `sent_at = now()`, `last_error = 'skipped: …'`. Otherwise send; on success
   set `sent_at`, on failure set `last_error` (truncated, never returned to
   the client) and clear `claimed_at` so it is retried.
4. Return `{ sent, failed }`.

### `POST /api/dispatch/flush`

- Auth: signed-in tenant member; schema from `user.app_metadata.tenant_schema`
  (never hardcoded). No section/role requirement — it only drains the
  caller's own tenant's queue and returns counts.
- Responds `{ sent, failed }`; errors map to a generic message.
- Callers:
  - `AddSaleModal` / `EditSaleModal`: fire-and-forget `fetch` after a
    successful save (failure ignored; the queue persists).
  - Integrations review/import route: calls `flushDispatchOutbox(schema)`
    directly after inserting sales.
  - Sales CSV import: fire-and-forget after the batch completes.
  - `DispatchBanner` mount: one fire-and-forget call per page load as a
    safety net for anything missed.

## UI

### Location modal (`inventory/_components/LocationModal.tsx`)

- New optional **Dispatcher** `Select`: "None" + active tenant users with
  at least View (≥ 1) access to the `sales` section (`effectiveAccess` from
  `lib/permissions/sections.ts`). Pure option builder
  `dispatcherOptions(users)` in `inventory/_lib/` with a test.
- Hidden for `dropship` locations (they hold no stock).
- `LocationsTab` gains a **Dispatcher** column (name or "—").
- Saving follows existing form conventions (toast on success/failure,
  busy label) and writes an audit log entry for the dispatcher change.

### `DispatchBanner` (`src/components/layout/DispatchBanner.tsx`)

- Rendered in `DashboardShell` below the impersonation banner.
- Data: one RPC `my_dispatch_queue()` (`SECURITY INVOKER`, returns
  `location_id, location_name, open_count` for locations where
  `dispatcher_id = auth.uid()`, counting sales with `product_id IS NOT NULL`
  and `lower(status) IN ('pending','processing')`). Result is bounded by the
  number of locations, so no pagination needed. RLS on `sales` still applies.
- Renders nothing when the result is empty, the plan lacks advanced
  inventory, or advanced inventory is off.
- Copy: "You have **3 orders** to dispatch from **Berlin Warehouse**" — one
  line per location, each linking to
  `/dashboard/sales?location=<id>&status=open`. Uses existing tokens
  (warning-tinted, `lucide-react` `PackageCheck` icon). Not dismissible.
- Refetches on route change and when the sales slice records a save.

### Orders page (`dashboard/sales/`)

- No location filter exists today. Add a `location` filter (URL param
  `location`, applied as `.eq('fulfillment_location_id', …)` in
  `fetchSalesPage`) and support `status=open` as shorthand for
  `pending`+`processing`. Location filter only rendered when advanced
  inventory is enabled.

### Bell

- `NotificationType` gains `'inventory.dispatch_assigned'`; `NotificationBell`
  icon/label mapping updated.

## Security & invariants

- No `public.*` queries; schema always from `app_metadata`.
- Outbox and claim RPC are service-role only; `authenticated` cannot read
  emails/addresses through them.
- Notifications still have no insert policy for `authenticated`; rows are
  written only by the `SECURITY DEFINER` trigger.
- SMTP credentials are non-`NEXT_PUBLIC_` and only read in server-only modules.
- The flush route never returns raw Postgres/SMTP errors.

## Testing

Jest (colocated):
- `lib/email/dispatchEmail.test.ts` — content, escaping of hostile input, link.
- `lib/dispatch/flushOutbox.test.ts` — mocked client + transport: SMTP not
  configured, success path, send failure (retry state), inactive recipient skip.
- `lib/dispatch/openStatus.test.ts` — `isOpenDispatchStatus()` shared by the
  banner link/filter and kept in sync with the SQL list.
- `inventory/_lib/dispatcherOptions.test.ts` — filters inactive users and users without Orders access.
- `salesSlice` test for the `location` and `status=open` filters.

SQL: after applying 057 to Project B, a verification script (in the PR
description) that inserts a sale with product + location in a transaction,
checks `dispatch_notified_at`, the notification row and the outbox row, then
rolls back.

## Rollout

1. Merge PR; apply `057_location_dispatchers.sql` to Project B and re-apply
   `005_tenant_provisioning.sql`. Update `supabase/SKILL.md` file-map status.
2. Add `SMTP_*` env vars in Vercel (same Mailgun credentials as Supabase SMTP).
3. Assign a dispatcher to a location, link a product to an open order, confirm
   email + bell + banner.

## Out of scope

- Multiple dispatchers per location, per-user email opt-out, digest emails.
- Marking an order dispatched from the email.
- Notifying for orders without a linked product.
