# In-app notifications

**Date:** 2026-08-03
**Status:** Design approved by user. Ready for an implementation plan.
**Scope:** In-app notification bell only. Email and push are explicitly out of
scope for v1, but the schema is designed so they can be added without migration
of existing rows.

## Problem

Users need to know about things that happened while they were away: new eBay
buyer messages, new orders, new purchases, and products falling to low stock.

## PREREQUISITE: live schema drift (verified 2026-08-03 via Supabase MCP)

`list_migrations` returns **empty** — there is no migration ledger, so
apply-status was established by inspecting schema objects directly. There are
**5 live tenant schemas**: `tenant_kaufnest`, `tenant_hochkauf`,
`tenant_k2_textil`, `tenant_testing`, `tenant_waqasmumtaz`.

Every tenant is missing a *different* set of migrations:

| Missing object | Affected schemas |
|---|---|
| `ebay_messages` table | **all 5** — the messages feature (commit `ca1c6ac`, #44) was never applied |
| `profiles.permission_overrides` + `current_user_has_override()` (023) | `tenant_testing` |
| `sales.shipping_cost` / `shipping_charged` / `advertising_fee` (010) | `tenant_testing` |
| `purchases.sale_id` | `tenant_hochkauf` |
| `dropship_listings` | all except `tenant_kaufnest` |

**Two of these block this feature outright:**

1. **`ebay_messages` does not exist anywhere**, so the `message.received`
   trigger has no table to attach to.
2. **`tenant_testing` lacks `current_user_has_override()`**, which the
   `notifications_select` RLS policy calls. Because the migration runs through
   `run_on_all_tenant_schemas`, it would fail *partway through* the fan-out,
   leaving some tenants migrated and others not — with no ledger to say which.

**Decision: repair first, as phase 0 of the implementation plan.** No new
notifications DDL runs until all five schemas are verified uniform.

## What already exists (and what does not)

| Thing | Status |
|---|---|
| `audit_logs` table | Records create/update/delete for expense, purchase, sale, user, product, message + login/logout, per tenant, RLS-enabled |
| `ebay_messages.is_read` | Already tracks per-message read state |
| `products.reorder_threshold` | Already exists — the low-stock threshold |
| `src/app/api/notifications/` | **Already exists but is unrelated** — eBay Marketplace Account Deletion webhook. Do NOT put user-facing notification routes under this path |
| Supabase Realtime | **Not used anywhere** — zero `.channel()` calls in the codebase |
| Cron / scheduled jobs | **None.** A cron route was once documented but never existed (removed in the 2026-07-24 audit) |
| Email provider | **None** beyond Supabase's built-in invite mail |

## The decisive constraint: `audit_logs` is admin-only

The obvious cheap design — derive the notification feed from `audit_logs`, which
is already an event stream — **does not work**. Its RLS policy
(`005_tenant_provisioning.sql:502`) is:

```sql
USING (is_tenant_member() AND current_user_role() IN ('admin','super_admin'))
```

Roles in this system are `super_admin | admin | accountant`. An accountant can
create and edit sales, purchases and expenses, but **cannot read `audit_logs`** —
so a derived feed would give them a permanently empty bell. This would not show
up in testing by a super_admin.

Loosening that policy was rejected: audit metadata contains before/after diffs of
every edit, including role changes and permission grants. It is admin-only
deliberately.

**Therefore: a dedicated `notifications` table with its own RLS.**

## Core simplification

**Visibility is enforced entirely in RLS, so the client needs no permission
logic.** The bell issues a plain `select` and Postgres returns exactly the rows
this user may see. There is no TypeScript mirror of the visibility matrix, and
therefore no possibility of the UI and the database disagreeing about what a
user is allowed to see.

## Two kinds of "notification"

The original request mixed two different things, and they need different
handling:

- **Events** — new message, new order, new purchase. Discrete, timestamped,
  happened once. Stored as rows.
- **State** — low stock is a *condition* (`current_stock <= reorder_threshold`)
  that flips back and forth. Naively stored as an event, every unit sold near
  the threshold generates another notification and the user drowns.

Low stock is converted into an event by firing **only on the crossing** (see
Triggers below).

## Schema

```sql
CREATE TABLE {{schema}}.notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                text NOT NULL,   -- 'sale.created' | 'purchase.created'
                                       -- | 'product.low_stock' | 'message.received'
  category            text NOT NULL,   -- 'orders' | 'purchases' | 'inventory' | 'messages'
  entity_type         text,
  entity_id           uuid,
  title               text NOT NULL,
  body                text,
  link                text,            -- e.g. '/dashboard/sales/<id>'
  payload             jsonb,           -- structured, channel-agnostic
  actor_id            uuid,            -- who caused it; used to suppress self-notifications
  visible_to_roles    text[] NOT NULL,
  required_permission text,            -- optional override key, e.g. 'manage_messages'
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE {{schema}}.notification_reads (
  notification_id uuid REFERENCES {{schema}}.notifications(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES {{schema}}.profiles(id)      ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE {{schema}}.profiles
  ADD COLUMN IF NOT EXISTS notifications_read_through timestamptz;
```

Indexes: `notifications (created_at DESC)`, `notifications (category)`,
`notification_reads (user_id)`.

**One row per event, not per user.** A 20-user tenant receiving one order writes
one row, not twenty. Visibility is a property of the row, resolved per reader by
RLS.

**Why both a reads table and a watermark:** the watermark makes "mark all as
read" a single `UPDATE` rather than N inserts; the reads table allows dismissing
an individual item after that point.

Unread for the current user =
row is visible to them
AND `created_at > coalesce(notifications_read_through, '-infinity')`
AND no matching `notification_reads` row
AND `actor_id IS DISTINCT FROM auth.uid()` (never notify someone about their own action).

## RLS

```sql
CREATE POLICY "notifications_select" ON {{schema}}.notifications FOR SELECT USING (
  {{schema}}.is_tenant_member()
  AND ( {{schema}}.current_user_role() = ANY(visible_to_roles)
        OR ( required_permission IS NOT NULL
             AND {{schema}}.current_user_has_override(required_permission) ) )
);
```

Reuses three helpers that already exist: `is_tenant_member()`,
`current_user_role()`, `current_user_has_override()`. The additive-override
model matches how purchases delete-gating already works.

`notification_reads` policies scope every operation to `user_id = auth.uid()`.

Both tables must be added to the RLS-enable loop and the grants block in
`provision_tenant_schema()`. Note the comment already in that file: `CREATE
SCHEMA` grants nothing by default, and without explicit grants PostgREST fails
with 42501 *before* RLS is even evaluated.

## Visibility matrix

Mirrors the permission that already gates each underlying feature.

| Type | Category | `visible_to_roles` | `required_permission` |
|---|---|---|---|
| `sale.created` | orders | super_admin, admin, accountant | — |
| `purchase.created` | purchases | super_admin, admin, accountant | — |
| `product.low_stock` | inventory | super_admin, admin, accountant | — |
| `message.received` | messages | super_admin, admin | `manage_messages` |

Inventory gets all three roles because there is **no inventory permission key**
in `lib/utils/permissions.ts` today. Messages follow `manage_messages`
(`super_admin`/`admin`), with the `required_permission` column letting an
accountant who has been granted that override receive them too.

## Population — DB triggers, not application code

Four new `AFTER INSERT/UPDATE` triggers, on `sales`, `purchases`, `products` and
`ebay_messages`.

**Why triggers and not calls next to `writeAuditLog`:** events arrive through
paths the UI does not own — the integration order-import route, the CSV import
modals, and eBay message sync all write directly to these tables. App-side calls
would miss all three, and the symptom would look like "notifications randomly
don't fire for eBay orders".

**These are new, separate triggers.** They must NOT modify
`apply_purchase_stock_change` / `apply_sale_stock_change` in
`002_inventory_and_vat.sql`, which own all stock arithmetic and are the riskiest
code in the schema.

`message.received` fires only for inbound messages — `direction = 'inbound'`
(`MessageDirection = "inbound" | "outbound"` in `src/types/index.ts`) — not for
replies the tenant sends. Its `actor_id` is `NULL`, since the actor is an
external buyer rather than a tenant user.

### Low stock fires only on the crossing

```sql
IF NEW.reorder_threshold IS NOT NULL
   AND NEW.current_stock <= NEW.reorder_threshold
   AND OLD.current_stock >  OLD.reorder_threshold THEN
  -- insert notification
END IF;
```

Selling ten more units below the threshold produces no further notifications,
and the condition re-arms automatically when a purchase lifts stock back above
the threshold. No extra state column is needed.

## Extensibility to email and push

What makes later channels cheap is keeping *what happened* separate from *how it
is displayed*:

- `type` + `payload` are the semantic record. A future email templater reads
  these and renders its own body.
- `title` / `body` / `link` are the rendered in-app form. Email must **not**
  scrape these.

Adding email later requires: a `notification_preferences` table (per user, per
category, per channel), a `notification_deliveries` table for send state and
retries, an email provider, and a scheduled worker. **None of this is built
now**, and note that this project currently has neither cron infrastructure nor
an email provider — email is a genuinely separate project, not a follow-up
commit.

## UI

**Bell in `src/components/layout/DashboardShell.tsx`**, beside the existing theme
toggle and user menu — that component already has the outside-click dropdown
pattern (`userMenuRef` + `mousedown` listener) to copy. Unread count badge,
dropdown of recent notifications, "mark all read" action, each row deep-linking
via `link`.

**State: `src/store/slices/notificationsSlice.ts`** — shared, not feature-private,
because the shell is core wiring and the bell renders on every dashboard page.
This matches the stated rule that shared state is for things used by 3+ features
or core wiring.

**Polling** on an interval for the unread count, since delivery is in-app only
and there is no Realtime in this codebase.

**Unread, not "since last logged in".** The original request asked for "new order
since last logged in". Unread state is used instead because: a user who stays
logged in for a week would never see anything; logging in on a second device
would clear it; and the `audit_logs` login-row watermark has an off-by-one, since
the current session writes its own login row (last login is the *second* most
recent row, not the most recent).

## Testing

Per the AGENTS.md working agreement: no dev server, no `curl`, and the agent does
not run `npm test` / `tsc` / `lint` mid-task — the user runs them and pastes
output.

Pure helpers with colocated tests:
- unread-count derivation (watermark + reads-table + own-actor exclusion)
- notification type → display mapping (icon, label, styling)
- feed grouping/sorting

Plus reducer tests for `notificationsSlice`.

The low-stock crossing condition deserves particular attention: stock going
below threshold once (fires), continuing to drop (does not fire), rising above
and dropping again (fires again), and a null `reorder_threshold` (never fires).

## Out of scope for v1

- Email notifications
- Browser push / Web Push
- Supabase Realtime live updates
- Per-user notification preferences or category muting
- Notifications for expenses, users, listings, or integrations
- Inventory catalog-change notifications (only the low-stock crossing)
- Any change to `audit_logs` or its RLS

## Migration checklist

1. New migration using `run_on_all_tenant_schemas` for both tables, the
   `profiles` column, indexes, RLS policies, grants, and the four triggers.
2. **The 2-places rule:** mirror all of the above into
   `provision_tenant_schema()` in `005_tenant_provisioning.sql`, including the
   RLS-enable loop array and the grants block, or new tenants are provisioned
   without notifications.
3. `Notification` / `NotificationRead` types added to `src/types/index.ts`
   (single source of truth for domain types); `Profile` gains
   `notifications_read_through`.

## Docs to update in the same commit

- `src/components/layout/` — no CLAUDE.md today; the bell is documented in the
  dashboard feature's CLAUDE.md as shell-level wiring
- `src/app/dashboard/CLAUDE.md` — the bell, the slice, the polling behaviour
- `src/app/dashboard/inventory/SKILL.md` — gotcha: the low-stock trigger fires
  on crossing only, and re-arms
- `src/app/dashboard/messages/SKILL.md` — gotcha: inbound-only notification
- `supabase/SKILL.md` — the new migration in the file-map/apply-status table
- Root `AGENTS.md` — note that `src/app/api/notifications/` is the eBay
  deletion webhook and unrelated to this feature

## Decisions taken, with rationale

| Decision | Chosen | Rejected because |
|---|---|---|
| Delivery surface | In-app bell only | Email needs a provider + cron, neither exists; push needs VAPID + service worker |
| Data source | Dedicated table | `audit_logs` RLS is admin-only → empty bell for accountants |
| Row model | One row per event | Per-user fan-out means N rows per event |
| Visibility | RLS on the row | A TS mirror of the matrix would drift from the DB |
| Population | DB triggers | App-side calls miss integration import, CSV import, message sync |
| Low stock | Crossing only | Storing it as a plain event spams on every unit sold near threshold |
| Read model | Watermark + reads table | Watermark alone gives no individual dismissal; reads alone makes "mark all" N inserts |
| Framing | Unread | "Since last login" breaks for long sessions, multi-device, and has a login-row off-by-one |
