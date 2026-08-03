# In-App Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app notification bell that tells every tenant user, filtered by their role and permission overrides, about new orders, new purchases, low stock, and new eBay buyer messages.

**Architecture:** A dedicated `notifications` table per tenant schema, one row per event (not per user), with visibility enforced entirely in RLS so the client needs no permission logic. Rows are written by database triggers on `sales`/`purchases`/`products`/`ebay_messages`, which catches events regardless of whether they originated in the UI, a CSV import, or the integration order-sync path. Per-user read state is a watermark column plus a `notification_reads` table.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Redux Toolkit, TypeScript, Jest.

**Source spec:** `docs/superpowers/specs/2026-08-03-in-app-notifications-design.md`

## Global Constraints

- **Never query `public.*`** for tenant data — all tenant data lives in `tenant_<slug>` schemas.
- **Never hardcode a schema name.** All tenant DDL goes through `SELECT public.run_on_all_tenant_schemas($$ ... {{schema}} ... $$)`.
- **The 2-places rule:** every tenant DDL change must ALSO be added to `provision_tenant_schema()` in `supabase/migrations/005_tenant_provisioning.sql`, or new tenants are provisioned without it.
- **All tenant DDL must be idempotent** (`IF NOT EXISTS` / `OR REPLACE` / `DROP ... IF EXISTS`) — `run_on_all_tenant_schemas` is re-runnable by design.
- **Never commit to `main`.** Branch first: `git checkout main && git pull && git checkout -b feat/notifications`.
- **Do not run `npm test`, `npx tsc --noEmit`, or `npm run lint` mid-task.** Ask the user to run them and paste output. Do not start a dev server or `curl` routes.
- **Docs are committed in the SAME commit as the code**, never as a follow-up.
- Husky hooks enforce gates: `pre-commit` runs `tsc --noEmit`, `eslint`, and the project verifier; `pre-push` runs `jest` and `next build`.
- The five live tenant schemas are: `tenant_kaufnest`, `tenant_hochkauf`, `tenant_k2_textil`, `tenant_testing`, `tenant_waqasmumtaz`.
- `src/app/api/notifications/` already exists and is the **eBay Marketplace Account Deletion webhook** — unrelated. Do not add user-facing notification routes under that path.

---

# Phase 0 — Reconcile live schema drift

**Why this phase exists.** Verified against the live database on 2026-08-03 via Supabase MCP: `list_migrations` returns empty (no ledger), and each tenant is missing a different set of migrations.

| Missing object | Affected schemas |
|---|---|
| `ebay_messages` table | **all 5** |
| `profiles.permission_overrides` + `current_user_has_override()` | `tenant_testing` |
| `sales.shipping_cost` / `shipping_charged` / `advertising_fee` | `tenant_testing` |
| `purchases.sale_id` | `tenant_hochkauf` |
| `dropship_listings` | all except `tenant_kaufnest` |

Two of these block this feature: the `message.received` trigger has no table to attach to, and the `notifications_select` policy calls `current_user_has_override()`, which does not exist in `tenant_testing`.

`dropship_listings` is deliberately **out of scope** — it is unrelated to notifications and reconciling it risks the dropshipping feature. It is recorded here so the gap is not forgotten.

---

### Task 1: Fix the root cause in `010_order_fees.sql`

`supabase/migrations/010_order_fees.sql` lines 17–24 hardcode `tenant_kaufnest`, bypassing the fan-out helper. This is why `tenant_testing` never received the order-fee columns. Fix the historical file so re-running it is safe and correct, then reconcile live.

**Files:**
- Modify: `supabase/migrations/010_order_fees.sql:17-24`

**Interfaces:**
- Produces: nothing consumed by later tasks; this is a correctness fix to a historical migration.

- [ ] **Step 1: Read the current hardcoded block**

Run: `sed -n '14,26p' supabase/migrations/010_order_fees.sql`

Expected: an `alter table tenant_kaufnest.sales add column if not exists ...` statement followed by three `comment on column tenant_kaufnest.sales....` lines.

- [ ] **Step 2: Replace the hardcoded block with a fan-out call**

Replace lines 17–24 (the `alter table tenant_kaufnest.sales ...` statement and the three `comment on column` lines) with:

```sql
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists shipping_cost    numeric(12,2) check (shipping_cost    >= 0),
    add column if not exists shipping_charged numeric(12,2) check (shipping_charged >= 0),
    add column if not exists advertising_fee  numeric(12,2) check (advertising_fee  >= 0);

  comment on column {{schema}}.sales.shipping_cost    is 'Shipping cost paid by seller. NULL = not recorded.';
  comment on column {{schema}}.sales.shipping_charged is 'Shipping billed to buyer (revenue side, appears on invoice). NULL = not recorded.';
  comment on column {{schema}}.sales.advertising_fee  is 'Per-order ad fee (eBay Promoted Listings / Amazon Ads). NULL = not recorded.';
$$);
```

- [ ] **Step 3: Add a header note recording the fix**

Insert directly above the block you just wrote:

```sql
-- FIXED 2026-08-03: this block previously hardcoded `tenant_kaufnest`, which is
-- why tenant_testing never received these columns. It now uses the fan-out
-- helper, per the rule in AGENTS.md. Re-running is safe (idempotent).
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/010_order_fees.sql
git commit -m "fix(supabase): 010 hardcoded tenant_kaufnest instead of fanning out"
```

---

### Task 2: Write the drift-reconciliation migration

One idempotent migration that replays every missing object across all five tenants. Every statement is safe to run against a tenant that already has the object.

**Files:**
- Create: `supabase/migrations/027_reconcile_tenant_drift.sql`

**Interfaces:**
- Produces: uniform `sales` fee columns, `purchases.sale_id`, `profiles.permission_overrides`, `current_user_has_override(text)`, and the `ebay_messages` table across all five tenant schemas. Task 5's RLS policy depends on `current_user_has_override`; Task 6's message trigger depends on `ebay_messages`.

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- 027 — Reconcile tenant schema drift (2026-08-03)
--
-- This repository has no migration ledger. A live audit via Supabase MCP on
-- 2026-08-03 found every tenant schema missing a DIFFERENT set of migrations:
--
--   ebay_messages (026)                     — missing in ALL 5 tenants
--   profiles.permission_overrides (023)     — missing in tenant_testing
--   current_user_has_override() (023)       — missing in tenant_testing
--   sales fee columns (010)                 — missing in tenant_testing
--   purchases.sale_id (015)                 — missing in tenant_hochkauf
--
-- Root cause for the 010 gap: that migration hardcoded `tenant_kaufnest`
-- instead of using run_on_all_tenant_schemas. Fixed in the same branch.
--
-- Every statement below is idempotent — re-running is safe and is the
-- intended way to bring a lagging tenant up to date.
--
-- NOTE: dropship_listings is missing from 4 of 5 tenants. That is deliberately
-- NOT reconciled here — it is unrelated to notifications and belongs to the
-- dropshipping feature. Tracked separately.
-- ============================================================

-- ── 010: order fee columns on sales ─────────────────────────
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists shipping_cost    numeric(12,2) check (shipping_cost    >= 0),
    add column if not exists shipping_charged numeric(12,2) check (shipping_charged >= 0),
    add column if not exists advertising_fee  numeric(12,2) check (advertising_fee  >= 0);
$$);

-- ── 015: purchases.sale_id + its indexes ────────────────────
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.purchases
    add column if not exists sale_id uuid
      references {{schema}}.sales(id) on delete set null;
$$);

select public.run_on_all_tenant_schemas($$
  create index if not exists idx_purchases_sale_id
    on {{schema}}.purchases (sale_id);
$$);

select public.run_on_all_tenant_schemas($$
  create unique index if not exists idx_purchases_sale_id_unique
    on {{schema}}.purchases (sale_id)
    where sale_id is not null;
$$);

-- ── 023: permission overrides column + helper function ──────
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.profiles
    add column if not exists permission_overrides jsonb not null default '[]'::jsonb;

  create or replace function {{schema}}.current_user_has_override(perm text)
  returns boolean
  language sql stable security definer
  set search_path = {{schema}}
  as $func$
    select coalesce(
      (select permission_overrides from profiles where id = auth.uid()) ? perm,
      false
    );
  $func$;

  drop policy if exists "expenses_delete" on {{schema}}.expenses;
  create policy "expenses_delete" on {{schema}}.expenses for delete using (
    {{schema}}.is_tenant_member()
    and ({{schema}}.current_user_role() in ('admin', 'super_admin')
         or {{schema}}.current_user_has_override('delete_expense'))
  );

  drop policy if exists "purchases_delete" on {{schema}}.purchases;
  create policy "purchases_delete" on {{schema}}.purchases for delete using (
    {{schema}}.is_tenant_member()
    and ({{schema}}.current_user_role() in ('admin', 'super_admin')
         or {{schema}}.current_user_has_override('delete_purchase'))
  );

  drop policy if exists "sales_delete" on {{schema}}.sales;
  create policy "sales_delete" on {{schema}}.sales for delete using (
    {{schema}}.is_tenant_member()
    and ({{schema}}.current_user_role() in ('admin', 'super_admin')
         or {{schema}}.current_user_has_override('delete_sale'))
  );
$$);

-- ── 026: ebay_messages table ────────────────────────────────
select public.run_on_all_tenant_schemas($$
  create table if not exists {{schema}}.ebay_messages (
    id                   uuid primary key default gen_random_uuid(),
    external_message_id  text,
    item_id              text not null,
    buyer_username       text not null,
    direction            text not null check (direction in ('inbound', 'outbound')),
    subject              text,
    body                 text not null,
    question_type        text,
    is_read              boolean not null default false,
    ebay_created_at      timestamptz not null,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
  );

  create or replace trigger set_ebay_messages_updated_at
    before update on {{schema}}.ebay_messages
    for each row execute procedure public.set_updated_at();

  create unique index if not exists idx_ebay_messages_external_id
    on {{schema}}.ebay_messages (external_message_id)
    where external_message_id is not null;
  create index if not exists idx_ebay_messages_thread
    on {{schema}}.ebay_messages (buyer_username, item_id, ebay_created_at);

  alter table {{schema}}.ebay_messages enable row level security;

  drop policy if exists "ebay_messages_all_admin" on {{schema}}.ebay_messages;
  create policy "ebay_messages_all_admin" on {{schema}}.ebay_messages
    for all
    using ({{schema}}.is_tenant_member() and {{schema}}.current_user_role() in ('admin', 'super_admin'))
    with check ({{schema}}.is_tenant_member() and {{schema}}.current_user_role() in ('admin', 'super_admin'));

  grant select, insert, update, delete on {{schema}}.ebay_messages to authenticated;
$$);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/027_reconcile_tenant_drift.sql
git commit -m "feat(supabase): add 027 tenant drift reconciliation migration"
```

---

### Task 3: Apply 027 and verify uniformity

**This task modifies live production data. Ask the user for explicit approval before running anything.** Present the migration first.

**Files:**
- None — this is an operational task.

**Interfaces:**
- Produces: a verified-uniform schema across all five tenants. Every later task assumes this.

- [ ] **Step 1: Ask the user to approve applying 027 to the live database**

Show them the file. Do not proceed without an explicit yes.

- [ ] **Step 2: Apply the migration**

Use the `supabase-data` MCP server's `apply_migration` tool with name `027_reconcile_tenant_drift` and the file contents as the query.

- [ ] **Step 3: Verify no table-level drift remains**

Run via `mcp__supabase-data__execute_sql`:

```sql
select table_name,
       count(distinct table_schema) as tenant_count,
       string_agg(distinct table_schema, ', ' order by table_schema) as present_in
from information_schema.tables
where table_schema like 'tenant_%' and table_type = 'BASE TABLE'
group by table_name
having count(distinct table_schema) < 5
order by table_name;
```

Expected: exactly one row, for `dropship_listings` (known, out of scope). If `ebay_messages` still appears, the migration did not apply — stop and investigate.

- [ ] **Step 4: Verify no column-level drift remains**

```sql
with cols as (
  select table_name, column_name, count(distinct table_schema) as n
  from information_schema.columns
  where table_schema like 'tenant_%'
  group by table_name, column_name
)
select * from cols where n < 5 and table_name <> 'dropship_listings'
order by table_name, column_name;
```

Expected: **zero rows.**

- [ ] **Step 5: Verify the override helper now exists everywhere**

```sql
select n.nspname as schema_name, count(*) filter (where p.proname = 'current_user_has_override') as has_override
from pg_namespace n
left join pg_proc p on p.pronamespace = n.oid
where n.nspname like 'tenant_%'
group by n.nspname order by n.nspname;
```

Expected: `has_override = 1` for all five schemas.

- [ ] **Step 6: Report results to the user**

State plainly which checks passed and paste the actual query output. Do not claim success without the output.

---

# Phase 1 — Notifications schema

### Task 4: Notification types in the shared type file

**Files:**
- Modify: `src/types/index.ts` (add after the `AuditLog` block; add `notifications_read_through` to `Profile`)

**Interfaces:**
- Produces: `NotificationType`, `NotificationCategory`, `Notification`, `NotificationRead` — consumed by Tasks 7, 8, 9, 10.

- [ ] **Step 1: Add the notification types**

Add to `src/types/index.ts`, after the `AuditLog` interface:

```typescript
// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationType =
  | "sale.created"
  | "purchase.created"
  | "product.low_stock"
  | "message.received";

export type NotificationCategory = "orders" | "purchases" | "inventory" | "messages";

export interface Notification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string | null;
  /** Dashboard-relative deep link, e.g. "/dashboard/sales/<id>". */
  link: string | null;
  /** Structured, channel-agnostic data. Email/push templating reads THIS, never title/body. */
  payload: Record<string, unknown> | null;
  /** Who caused the event. Null for externally-caused events (e.g. an inbound buyer message). */
  actor_id: string | null;
  visible_to_roles: UserRole[];
  /** Permission-override key that also grants visibility, e.g. "manage_messages". */
  required_permission: string | null;
  created_at: string;
}

export interface NotificationRead {
  notification_id: string;
  user_id: string;
  read_at: string;
}
```

- [ ] **Step 2: Add the watermark field to `Profile`**

In the `Profile` interface, after `status`:

```typescript
  /**
   * Bulk "mark all as read" watermark. Notifications created at or before this
   * timestamp are read. Individual dismissals after it live in
   * `notification_reads`. Null = nothing has ever been marked read.
   */
  notifications_read_through: string | null;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add Notification, NotificationRead, and read watermark"
```

---

### Task 5: Notifications tables, RLS, and grants

**Files:**
- Create: `supabase/migrations/028_notifications.sql`

**Interfaces:**
- Consumes: `current_user_has_override(text)`, `is_tenant_member()`, `current_user_role()` — all guaranteed present by Task 3.
- Produces: `{{schema}}.notifications`, `{{schema}}.notification_reads`, `profiles.notifications_read_through`. Task 6's triggers insert into `notifications`.

- [ ] **Step 1: Create the migration**

```sql
-- ============================================================
-- 028 — In-app notifications
--
-- One row per EVENT, not per user. Visibility is a property of the row and is
-- resolved per reader by RLS, so the client needs no permission logic at all —
-- a plain `select` returns exactly what the current user may see.
--
-- Rows are written ONLY by the triggers in this file, which are SECURITY
-- DEFINER and owned by the schema owner (owners bypass RLS). There is
-- deliberately NO insert policy for `authenticated` — users must never be able
-- to forge a notification.
--
-- Also baked into provision_tenant_schema() (005) — see the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  create table if not exists {{schema}}.notifications (
    id                  uuid primary key default gen_random_uuid(),
    type                text not null,
    category            text not null,
    entity_type         text,
    entity_id           uuid,
    title               text not null,
    body                text,
    link                text,
    payload             jsonb,
    actor_id            uuid,
    visible_to_roles    text[] not null,
    required_permission text,
    created_at          timestamptz not null default now()
  );

  create table if not exists {{schema}}.notification_reads (
    notification_id uuid not null references {{schema}}.notifications(id) on delete cascade,
    user_id         uuid not null references {{schema}}.profiles(id)      on delete cascade,
    read_at         timestamptz not null default now(),
    primary key (notification_id, user_id)
  );

  alter table {{schema}}.profiles
    add column if not exists notifications_read_through timestamptz;

  create index if not exists idx_notifications_created
    on {{schema}}.notifications (created_at desc);
  create index if not exists idx_notifications_category
    on {{schema}}.notifications (category);
  create index if not exists idx_notification_reads_user
    on {{schema}}.notification_reads (user_id);

  alter table {{schema}}.notifications      enable row level security;
  alter table {{schema}}.notification_reads enable row level security;

  -- Read: tenant members see rows their role allows, plus rows unlocked by an
  -- additive per-user permission override.
  drop policy if exists "notifications_select" on {{schema}}.notifications;
  create policy "notifications_select" on {{schema}}.notifications for select using (
    {{schema}}.is_tenant_member()
    and ( {{schema}}.current_user_role() = any(visible_to_roles)
          or ( required_permission is not null
               and {{schema}}.current_user_has_override(required_permission) ) )
  );

  -- No insert/update/delete policy on notifications: only SECURITY DEFINER
  -- triggers write here.

  drop policy if exists "notification_reads_select" on {{schema}}.notification_reads;
  create policy "notification_reads_select" on {{schema}}.notification_reads for select using (
    {{schema}}.is_tenant_member() and user_id = auth.uid()
  );

  drop policy if exists "notification_reads_insert" on {{schema}}.notification_reads;
  create policy "notification_reads_insert" on {{schema}}.notification_reads for insert with check (
    {{schema}}.is_tenant_member() and user_id = auth.uid()
  );

  drop policy if exists "notification_reads_delete" on {{schema}}.notification_reads;
  create policy "notification_reads_delete" on {{schema}}.notification_reads for delete using (
    {{schema}}.is_tenant_member() and user_id = auth.uid()
  );

  -- Grants: CREATE SCHEMA grants nothing by default. Without these, PostgREST
  -- fails with 42501 BEFORE RLS is even evaluated.
  grant select on {{schema}}.notifications to authenticated;
  grant select, insert, delete on {{schema}}.notification_reads to authenticated;
$$);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/028_notifications.sql
git commit -m "feat(supabase): add notifications tables, RLS, and grants"
```

---

### Task 6: Notification triggers

**Files:**
- Create: `supabase/migrations/029_notification_triggers.sql`

**Interfaces:**
- Consumes: `{{schema}}.notifications` (Task 5), `{{schema}}.ebay_messages` (Task 3).
- Produces: notification rows on insert into `sales`/`purchases`/`ebay_messages` and on low-stock crossing in `products`.

- [ ] **Step 1: Create the migration**

```sql
-- ============================================================
-- 029 — Notification triggers
--
-- WHY TRIGGERS, NOT APPLICATION CODE: events arrive through paths the UI does
-- not own — the integration order-import route, the CSV import modals, and the
-- eBay message sync all write directly to these tables. App-side calls next to
-- writeAuditLog() would miss all three, and the symptom would look like
-- "notifications randomly don't fire for eBay orders".
--
-- These are NEW, SEPARATE triggers. They do NOT modify
-- apply_purchase_stock_change / apply_sale_stock_change (002), which own all
-- stock arithmetic and are the riskiest code in the schema.
--
-- All functions are SECURITY DEFINER so they can insert into `notifications`,
-- which has no insert policy for `authenticated` — users must never be able to
-- forge a notification. search_path is pinned on every one.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  -- ── sale.created ──────────────────────────────────────────
  create or replace function {{schema}}.notify_sale_created()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    insert into {{schema}}.notifications
      (type, category, entity_type, entity_id, title, body, link,
       payload, actor_id, visible_to_roles, required_permission)
    values (
      'sale.created', 'orders', 'sale', new.id,
      'New order: ' || new.product_name,
      new.quantity || ' × ' || new.product_name || ' — '
        || new.total_amount || ' ' || new.currency,
      '/dashboard/sales/' || new.id,
      jsonb_build_object(
        'platform',     new.platform,
        'quantity',     new.quantity,
        'total_amount', new.total_amount,
        'currency',     new.currency
      ),
      new.created_by,
      array['super_admin','admin','accountant'],
      null
    );
    return new;
  end;
  $fn$;

  drop trigger if exists notify_sale_created on {{schema}}.sales;
  create trigger notify_sale_created
    after insert on {{schema}}.sales
    for each row execute function {{schema}}.notify_sale_created();

  -- ── purchase.created ──────────────────────────────────────
  create or replace function {{schema}}.notify_purchase_created()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    insert into {{schema}}.notifications
      (type, category, entity_type, entity_id, title, body, link,
       payload, actor_id, visible_to_roles, required_permission)
    values (
      'purchase.created', 'purchases', 'purchase', new.id,
      'New purchase: ' || new.product_name,
      new.quantity || ' × ' || new.product_name || ' — '
        || new.total_amount || ' ' || new.currency,
      '/dashboard/purchases',
      jsonb_build_object(
        'quantity',     new.quantity,
        'total_amount', new.total_amount,
        'currency',     new.currency,
        'vendor',       new.vendor
      ),
      new.created_by,
      array['super_admin','admin','accountant'],
      null
    );
    return new;
  end;
  $fn$;

  drop trigger if exists notify_purchase_created on {{schema}}.purchases;
  create trigger notify_purchase_created
    after insert on {{schema}}.purchases
    for each row execute function {{schema}}.notify_purchase_created();

  -- ── product.low_stock ─────────────────────────────────────
  -- Fires ONLY on the downward crossing. Selling ten more units below the
  -- threshold produces nothing further, and the condition re-arms by itself
  -- when a purchase lifts stock back above the threshold. No state column.
  create or replace function {{schema}}.notify_low_stock()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    if new.reorder_threshold is not null
       and new.current_stock <= new.reorder_threshold
       and (old.reorder_threshold is null
            or old.current_stock > old.reorder_threshold) then
      insert into {{schema}}.notifications
        (type, category, entity_type, entity_id, title, body, link,
         payload, actor_id, visible_to_roles, required_permission)
      values (
        'product.low_stock', 'inventory', 'product', new.id,
        'Low stock: ' || new.name,
        new.current_stock || ' left (threshold ' || new.reorder_threshold || ')',
        '/dashboard/inventory',
        jsonb_build_object(
          'sku',               new.sku,
          'current_stock',     new.current_stock,
          'reorder_threshold', new.reorder_threshold
        ),
        null,
        array['super_admin','admin','accountant'],
        null
      );
    end if;
    return new;
  end;
  $fn$;

  drop trigger if exists notify_low_stock on {{schema}}.products;
  create trigger notify_low_stock
    after update on {{schema}}.products
    for each row execute function {{schema}}.notify_low_stock();

  -- ── message.received ──────────────────────────────────────
  -- Inbound only. actor_id is null: the actor is an external buyer, not a
  -- tenant user. Visible to admins by role, and to anyone granted the
  -- `manage_messages` override.
  create or replace function {{schema}}.notify_message_received()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    if new.direction = 'inbound' then
      insert into {{schema}}.notifications
        (type, category, entity_type, entity_id, title, body, link,
         payload, actor_id, visible_to_roles, required_permission)
      values (
        'message.received', 'messages', 'message', new.id,
        'New message from ' || new.buyer_username,
        coalesce(new.subject, left(new.body, 120)),
        '/dashboard/messages',
        jsonb_build_object(
          'buyer_username', new.buyer_username,
          'item_id',        new.item_id,
          'subject',        new.subject
        ),
        null,
        array['super_admin','admin'],
        'manage_messages'
      );
    end if;
    return new;
  end;
  $fn$;

  drop trigger if exists notify_message_received on {{schema}}.ebay_messages;
  create trigger notify_message_received
    after insert on {{schema}}.ebay_messages
    for each row execute function {{schema}}.notify_message_received();
$$);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/029_notification_triggers.sql
git commit -m "feat(supabase): add notification triggers for orders, purchases, low stock, messages"
```

---

### Task 7: Bake notifications into `provision_tenant_schema()` (the 2-places rule)

Without this, every NEW tenant is provisioned without notifications and the bell is silently empty for them — the same class of bug Phase 0 just cleaned up.

**Files:**
- Modify: `supabase/migrations/005_tenant_provisioning.sql`

**Interfaces:**
- Produces: new tenants get the full notifications stack at provision time.

- [ ] **Step 1: Add `notifications_read_through` to the `profiles` table definition**

In `provision_tenant_schema()`, find the `CREATE TABLE IF NOT EXISTS %1$I.profiles` block and add this column before `created_at`:

```sql
      notifications_read_through timestamptz,
```

- [ ] **Step 2: Add both tables**

Immediately after the `audit_logs` `CREATE TABLE` block (around line 195), insert:

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.notifications (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type                text NOT NULL,
      category            text NOT NULL,
      entity_type         text,
      entity_id           uuid,
      title               text NOT NULL,
      body                text,
      link                text,
      payload             jsonb,
      actor_id            uuid,
      visible_to_roles    text[] NOT NULL,
      required_permission text,
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.notification_reads (
      notification_id uuid NOT NULL REFERENCES %1$I.notifications(id) ON DELETE CASCADE,
      user_id         uuid NOT NULL REFERENCES %1$I.profiles(id)      ON DELETE CASCADE,
      read_at         timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (notification_id, user_id)
    )
  $sql$, schema_name);
```

- [ ] **Step 3: Add both tables to the RLS-enable loop**

Find `FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', ...]` (around line 457) and append `'notifications', 'notification_reads'` to the array literal.

- [ ] **Step 4: Add the policies**

In the policy section, alongside the other `CREATE POLICY` calls:

```sql
  EXECUTE format('CREATE POLICY "notifications_select" ON %1$I.notifications FOR SELECT USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() = ANY(visible_to_roles) OR (required_permission IS NOT NULL AND %1$I.current_user_has_override(required_permission))))', schema_name);
  EXECUTE format('CREATE POLICY "notification_reads_select" ON %1$I.notification_reads FOR SELECT USING (%1$I.is_tenant_member() AND user_id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "notification_reads_insert" ON %1$I.notification_reads FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND user_id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "notification_reads_delete" ON %1$I.notification_reads FOR DELETE USING (%1$I.is_tenant_member() AND user_id = auth.uid())', schema_name);
```

There is deliberately **no insert policy on `notifications`** — only the SECURITY DEFINER triggers write there.

- [ ] **Step 5: Add the indexes and grants**

```sql
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_created ON %1$I.notifications (created_at DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_category ON %1$I.notifications (category)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON %1$I.notification_reads (user_id)', schema_name);

  EXECUTE format('GRANT SELECT ON %1$I.notifications TO authenticated', schema_name);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON %1$I.notification_reads TO authenticated', schema_name);
```

- [ ] **Step 6: Add the four trigger functions**

```sql
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_sale_created()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I, public
    AS $fn$
    BEGIN
      INSERT INTO %1$I.notifications
        (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
      VALUES ('sale.created', 'orders', 'sale', new.id,
        'New order: ' || new.product_name,
        new.quantity || ' × ' || new.product_name || ' — ' || new.total_amount || ' ' || new.currency,
        '/dashboard/sales/' || new.id,
        jsonb_build_object('platform', new.platform, 'quantity', new.quantity,
                           'total_amount', new.total_amount, 'currency', new.currency),
        new.created_by, ARRAY['super_admin','admin','accountant'], NULL);
      RETURN new;
    END;
    $fn$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_purchase_created()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I, public
    AS $fn$
    BEGIN
      INSERT INTO %1$I.notifications
        (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
      VALUES ('purchase.created', 'purchases', 'purchase', new.id,
        'New purchase: ' || new.product_name,
        new.quantity || ' × ' || new.product_name || ' — ' || new.total_amount || ' ' || new.currency,
        '/dashboard/purchases',
        jsonb_build_object('quantity', new.quantity, 'total_amount', new.total_amount,
                           'currency', new.currency, 'vendor', new.vendor),
        new.created_by, ARRAY['super_admin','admin','accountant'], NULL);
      RETURN new;
    END;
    $fn$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_low_stock()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I, public
    AS $fn$
    BEGIN
      IF new.reorder_threshold IS NOT NULL
         AND new.current_stock <= new.reorder_threshold
         AND (old.reorder_threshold IS NULL OR old.current_stock > old.reorder_threshold) THEN
        INSERT INTO %1$I.notifications
          (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
        VALUES ('product.low_stock', 'inventory', 'product', new.id,
          'Low stock: ' || new.name,
          new.current_stock || ' left (threshold ' || new.reorder_threshold || ')',
          '/dashboard/inventory',
          jsonb_build_object('sku', new.sku, 'current_stock', new.current_stock,
                             'reorder_threshold', new.reorder_threshold),
          NULL, ARRAY['super_admin','admin','accountant'], NULL);
      END IF;
      RETURN new;
    END;
    $fn$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_message_received()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = %1$I, public
    AS $fn$
    BEGIN
      IF new.direction = 'inbound' THEN
        INSERT INTO %1$I.notifications
          (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
        VALUES ('message.received', 'messages', 'message', new.id,
          'New message from ' || new.buyer_username,
          coalesce(new.subject, left(new.body, 120)),
          '/dashboard/messages',
          jsonb_build_object('buyer_username', new.buyer_username, 'item_id', new.item_id,
                             'subject', new.subject),
          NULL, ARRAY['super_admin','admin'], 'manage_messages');
      END IF;
      RETURN new;
    END;
    $fn$;
  $sql$, schema_name);
```

- [ ] **Step 7: Attach the four triggers**

```sql
  EXECUTE format('DROP TRIGGER IF EXISTS notify_sale_created ON %1$I.sales', schema_name);
  EXECUTE format('CREATE TRIGGER notify_sale_created AFTER INSERT ON %1$I.sales FOR EACH ROW EXECUTE FUNCTION %1$I.notify_sale_created()', schema_name);

  EXECUTE format('DROP TRIGGER IF EXISTS notify_purchase_created ON %1$I.purchases', schema_name);
  EXECUTE format('CREATE TRIGGER notify_purchase_created AFTER INSERT ON %1$I.purchases FOR EACH ROW EXECUTE FUNCTION %1$I.notify_purchase_created()', schema_name);

  EXECUTE format('DROP TRIGGER IF EXISTS notify_low_stock ON %1$I.products', schema_name);
  EXECUTE format('CREATE TRIGGER notify_low_stock AFTER UPDATE ON %1$I.products FOR EACH ROW EXECUTE FUNCTION %1$I.notify_low_stock()', schema_name);

  EXECUTE format('DROP TRIGGER IF EXISTS notify_message_received ON %1$I.ebay_messages', schema_name);
  EXECUTE format('CREATE TRIGGER notify_message_received AFTER INSERT ON %1$I.ebay_messages FOR EACH ROW EXECUTE FUNCTION %1$I.notify_message_received()', schema_name);
```

- [ ] **Step 8: Verify by provisioning a throwaway tenant**

Ask the user to approve, then run `select public.provision_tenant_schema('plan_smoke_test');` followed by the uniformity queries from Task 3. Then drop it with the existing `017_drop_tenant_schema.sql` helper.

Expected: `plan_smoke_test` has `notifications`, `notification_reads`, all four triggers, and `profiles.notifications_read_through`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/005_tenant_provisioning.sql
git commit -m "feat(supabase): provision notifications for new tenants (2-places rule)"
```

---

# Phase 2 — Pure helpers (TDD)

### Task 8: Unread derivation and display mapping

These are pure functions with no Supabase or Redux dependency, which is what makes the unread rule testable without rendering anything.

**Files:**
- Create: `src/lib/utils/notifications.ts`
- Test: `src/lib/utils/notifications.test.ts`

**Interfaces:**
- Consumes: `Notification`, `NotificationType` from `@/types` (Task 4).
- Produces:
  - `isUnread(n: Notification, opts: UnreadContext): boolean`
  - `unreadCount(items: Notification[], opts: UnreadContext): number`
  - `interface UnreadContext { readThrough: string | null; readIds: Set<string>; currentUserId: string }`
  - `NOTIFICATION_LABELS: Record<NotificationType, string>`
  Consumed by Tasks 9 and 10.

- [ ] **Step 1: Write the failing tests**

```typescript
import { isUnread, unreadCount, NOTIFICATION_LABELS, type UnreadContext } from "./notifications";
import type { Notification } from "@/types";

function make(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "sale.created",
    category: "orders",
    entity_type: "sale",
    entity_id: "s1",
    title: "New order",
    body: null,
    link: "/dashboard/sales/s1",
    payload: null,
    actor_id: "someone-else",
    visible_to_roles: ["admin"],
    required_permission: null,
    created_at: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

const base: UnreadContext = {
  readThrough: null,
  readIds: new Set<string>(),
  currentUserId: "me",
};

describe("isUnread", () => {
  it("treats a fresh notification from someone else as unread", () => {
    expect(isUnread(make(), base)).toBe(true);
  });

  it("never marks your own action as unread", () => {
    expect(isUnread(make({ actor_id: "me" }), base)).toBe(false);
  });

  it("treats a notification at or before the watermark as read", () => {
    expect(isUnread(make(), { ...base, readThrough: "2026-08-03T12:00:00Z" })).toBe(false);
  });

  it("treats a notification after the watermark as unread", () => {
    expect(isUnread(make(), { ...base, readThrough: "2026-08-03T11:59:59Z" })).toBe(true);
  });

  it("treats an individually dismissed notification as read", () => {
    expect(isUnread(make(), { ...base, readIds: new Set(["n1"]) })).toBe(false);
  });

  it("counts externally-caused notifications (null actor) as unread", () => {
    expect(isUnread(make({ actor_id: null }), base)).toBe(true);
  });
});

describe("unreadCount", () => {
  it("counts only unread items", () => {
    const items = [
      make({ id: "a" }),
      make({ id: "b", actor_id: "me" }),
      make({ id: "c" }),
    ];
    expect(unreadCount(items, base)).toBe(2);
  });

  it("returns zero for an empty list", () => {
    expect(unreadCount([], base)).toBe(0);
  });
});

describe("NOTIFICATION_LABELS", () => {
  it("has a label for every notification type", () => {
    expect(NOTIFICATION_LABELS["sale.created"]).toBe("Orders");
    expect(NOTIFICATION_LABELS["purchase.created"]).toBe("Purchases");
    expect(NOTIFICATION_LABELS["product.low_stock"]).toBe("Inventory");
    expect(NOTIFICATION_LABELS["message.received"]).toBe("Messages");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Ask the user to run:

```bash
npx jest src/lib/utils/notifications
```

Expected: FAIL — `Cannot find module './notifications'`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { Notification, NotificationType } from "@/types";

export interface UnreadContext {
  /** Bulk "mark all read" watermark from `profiles.notifications_read_through`. */
  readThrough: string | null;
  /** Ids individually dismissed after the watermark. */
  readIds: Set<string>;
  /** Current user's id — you are never notified about your own action. */
  currentUserId: string;
}

/**
 * A notification is unread when all of these hold:
 *   1. it was not caused by the current user
 *   2. it was created strictly after the bulk watermark
 *   3. it has not been individually dismissed
 *
 * `actor_id` is null for externally-caused events (an inbound buyer message),
 * which are always unread — nobody in the tenant caused them.
 */
export function isUnread(n: Notification, ctx: UnreadContext): boolean {
  if (n.actor_id !== null && n.actor_id === ctx.currentUserId) return false;
  if (ctx.readIds.has(n.id)) return false;
  if (ctx.readThrough !== null && n.created_at <= ctx.readThrough) return false;
  return true;
}

export function unreadCount(items: Notification[], ctx: UnreadContext): number {
  return items.reduce((total, n) => (isUnread(n, ctx) ? total + 1 : total), 0);
}

/** Grouping label shown in the bell dropdown. */
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  "sale.created": "Orders",
  "purchase.created": "Purchases",
  "product.low_stock": "Inventory",
  "message.received": "Messages",
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Ask the user to run `npx jest src/lib/utils/notifications`. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/notifications.ts src/lib/utils/notifications.test.ts
git commit -m "feat(notifications): add unread derivation and display helpers"
```

---

# Phase 3 — Redux state

### Task 9: `notificationsSlice`

Lives in `src/store/slices/` rather than a feature folder because the bell renders on every dashboard page — it is core wiring, matching the stated rule for shared state.

**Files:**
- Create: `src/store/slices/notificationsSlice.ts`
- Test: `src/store/slices/notificationsSlice.test.ts`
- Modify: `src/store/store.ts`

**Interfaces:**
- Consumes: `Notification` from `@/types`; `createTenantClient` from `@/lib/supabase/client`.
- Produces: `notificationsSlice`, actions `hydrateNotifications`, `markAllRead`, `dismissOne`, `setFetching`; thunk `fetchNotifications()`; state shape `{ items, readIds, readThrough, loaded, isFetching }` at `state.notifications`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

```typescript
import { notificationsSlice, hydrateNotifications, markAllRead, dismissOne, setFetching, fetchNotifications } from "./notificationsSlice";
import type { Notification } from "@/types";

const reducer = notificationsSlice.reducer;

function make(id: string): Notification {
  return {
    id, type: "sale.created", category: "orders",
    entity_type: "sale", entity_id: "s1", title: "New order",
    body: null, link: null, payload: null, actor_id: "other",
    visible_to_roles: ["admin"], required_permission: null,
    created_at: "2026-08-03T12:00:00Z",
  };
}

describe("notificationsSlice", () => {
  it("starts empty and unloaded", () => {
    const s = reducer(undefined, { type: "@@INIT" });
    expect(s.items).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.readThrough).toBeNull();
  });

  it("hydrates items and the watermark", () => {
    const s = reducer(undefined, hydrateNotifications({
      data: [make("a"), make("b")],
      readThrough: "2026-08-01T00:00:00Z",
      readIds: ["a"],
    }));
    expect(s.items).toHaveLength(2);
    expect(s.readThrough).toBe("2026-08-01T00:00:00Z");
    expect(s.readIds).toEqual(["a"]);
    expect(s.loaded).toBe(true);
  });

  it("markAllRead advances the watermark and clears per-id dismissals", () => {
    let s = reducer(undefined, hydrateNotifications({
      data: [make("a")], readThrough: null, readIds: ["a"],
    }));
    s = reducer(s, markAllRead("2026-08-03T13:00:00Z"));
    expect(s.readThrough).toBe("2026-08-03T13:00:00Z");
    expect(s.readIds).toEqual([]);
  });

  it("dismissOne adds an id without duplicating", () => {
    let s = reducer(undefined, hydrateNotifications({ data: [make("a")], readThrough: null, readIds: [] }));
    s = reducer(s, dismissOne("a"));
    s = reducer(s, dismissOne("a"));
    expect(s.readIds).toEqual(["a"]);
  });

  it("setFetching toggles the flag", () => {
    const s = reducer(undefined, setFetching(true));
    expect(s.isFetching).toBe(true);
  });

  // Regression guard: a fetch that restored only `items` would leave
  // readThrough/readIds empty, so every poll would re-count read items as
  // unread and silently undo "mark all read".
  it("fetchNotifications.fulfilled restores all three pieces of read state", () => {
    const s = reducer(undefined, {
      type: fetchNotifications.fulfilled.type,
      payload: {
        data: [make("a")],
        readIds: ["a"],
        readThrough: "2026-08-02T00:00:00Z",
      },
    });
    expect(s.items).toHaveLength(1);
    expect(s.readIds).toEqual(["a"]);
    expect(s.readThrough).toBe("2026-08-02T00:00:00Z");
    expect(s.isFetching).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Ask the user to run `npx jest src/store/slices/notificationsSlice`. Expected: FAIL — module not found.

- [ ] **Step 3: Write the slice**

```typescript
import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { createTenantClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

interface NotificationsState {
  items: Notification[];
  /** Ids dismissed individually, after the bulk watermark. */
  readIds: string[];
  /** Bulk "mark all read" watermark. */
  readThrough: string | null;
  loaded: boolean;
  isFetching: boolean;
}

const initialState: NotificationsState = {
  items: [],
  readIds: [],
  readThrough: null,
  loaded: false,
  isFetching: false,
};

/**
 * RLS does the filtering — this deliberately has no role/permission logic.
 * Whatever Postgres returns is exactly what this user is allowed to see.
 *
 * All THREE pieces of read state must be fetched together. Fetching only the
 * notifications would leave `readThrough`/`readIds` empty, so every poll would
 * re-count read items as unread and silently undo "mark all read".
 * `notification_reads` is already scoped to the current user by RLS.
 */
export const fetchNotifications = createAsyncThunk(
  "notifications/fetch",
  async ({ userId, limit = 30 }: { userId: string; limit?: number }) => {
    const supabase = await createTenantClient();

    const [notifs, reads, profile] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase.from("notification_reads").select("notification_id"),
      supabase
        .from("profiles")
        .select("notifications_read_through")
        .eq("id", userId)
        .single(),
    ]);

    if (notifs.error) throw notifs.error;
    if (reads.error) throw reads.error;
    if (profile.error) throw profile.error;

    return {
      data: (notifs.data ?? []) as Notification[],
      readIds: (reads.data ?? []).map((r) => r.notification_id as string),
      readThrough: (profile.data?.notifications_read_through ?? null) as string | null,
    };
  },
);

export const notificationsSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    hydrateNotifications: (
      state,
      action: PayloadAction<{ data: Notification[]; readThrough: string | null; readIds: string[] }>,
    ) => {
      state.items = action.payload.data;
      state.readThrough = action.payload.readThrough;
      state.readIds = action.payload.readIds;
      state.loaded = true;
      state.isFetching = false;
    },
    markAllRead: (state, action: PayloadAction<string>) => {
      state.readThrough = action.payload;
      // Per-id dismissals before the watermark are now redundant.
      state.readIds = [];
    },
    dismissOne: (state, action: PayloadAction<string>) => {
      if (!state.readIds.includes(action.payload)) state.readIds.push(action.payload);
    },
    setFetching: (state, action: PayloadAction<boolean>) => {
      state.isFetching = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.pending, (state) => { state.isFetching = true; })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.items = action.payload.data;
        state.readIds = action.payload.readIds;
        state.readThrough = action.payload.readThrough;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchNotifications.rejected, (state) => { state.isFetching = false; });
  },
});

export const { hydrateNotifications, markAllRead, dismissOne, setFetching } =
  notificationsSlice.actions;
```

- [ ] **Step 4: Run the tests to verify they pass**

Ask the user to run `npx jest src/store/slices/notificationsSlice`. Expected: all PASS.

- [ ] **Step 5: Register the slice in the store**

In `src/store/store.ts`, add the import alongside the other `./slices/` imports and `notifications: notificationsSlice.reducer,` to the `reducer` object.

- [ ] **Step 6: Commit**

```bash
git add src/store/slices/notificationsSlice.ts src/store/slices/notificationsSlice.test.ts src/store/store.ts
git commit -m "feat(notifications): add notificationsSlice and register it"
```

---

# Phase 4 — UI

### Task 10: The notification bell

**Files:**
- Create: `src/components/layout/NotificationBell.tsx`
- Modify: `src/components/layout/DashboardShell.tsx`

**Interfaces:**
- Consumes: `notificationsSlice` actions and `fetchNotifications` (Task 9); `isUnread`, `unreadCount`, `NOTIFICATION_LABELS` (Task 8); `useAppDispatch`/`useAppSelector` from `@/store/hooks`.
- Produces: `<NotificationBell currentUserId={...} />`, rendered inside `DashboardShell`'s header.

- [ ] **Step 1: Build the bell component**

Model the dropdown on the existing `userMenuRef` + `mousedown` outside-click pattern already in `DashboardShell.tsx` — do not invent a second pattern.

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createTenantClient } from "@/lib/supabase/client";
import {
  fetchNotifications,
  markAllRead,
  dismissOne,
} from "@/store/slices/notificationsSlice";
import { isUnread, unreadCount, NOTIFICATION_LABELS } from "@/lib/utils/notifications";

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const router = useRouter();

  const { items, readIds, readThrough } = useAppSelector((s) => s.notifications);
  const ctx = { readThrough, readIds: new Set(readIds), currentUserId };
  const count = unreadCount(items, ctx);

  useEffect(() => {
    dispatch(fetchNotifications({ userId: currentUserId }));
    const id = setInterval(
      () => { dispatch(fetchNotifications({ userId: currentUserId })); },
      POLL_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [dispatch, currentUserId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleMarkAllRead() {
    const now = new Date().toISOString();
    dispatch(markAllRead(now));
    const supabase = await createTenantClient();
    await supabase
      .from("profiles")
      .update({ notifications_read_through: now })
      .eq("id", currentUserId);
  }

  async function handleOpenOne(id: string, link: string | null) {
    dispatch(dismissOne(id));
    const supabase = await createTenantClient();
    await supabase
      .from("notification_reads")
      .insert({ notification_id: id, user_id: currentUserId });
    setOpen(false);
    if (link) router.push(link);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        className="relative p-2 rounded-md hover:bg-[var(--color-surface-subtle)] cursor-pointer"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[0.65rem] font-medium flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-30">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-sm font-medium">Notifications</span>
            {count > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs underline cursor-pointer">
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 && (
            <p className="px-3 py-6 text-sm text-center opacity-70">Nothing yet.</p>
          )}

          {items.map((n) => {
            const unread = isUnread(n, ctx);
            return (
              <button
                key={n.id}
                onClick={() => handleOpenOne(n.id, n.link)}
                className={`w-full text-left px-3 py-2 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-subtle)] cursor-pointer ${unread ? "font-medium" : "opacity-70"}`}
              >
                <span className="block text-[0.65rem] uppercase tracking-wide opacity-60">
                  {NOTIFICATION_LABELS[n.type]}
                </span>
                <span className="block text-sm">{n.title}</span>
                {n.body && <span className="block text-xs opacity-70">{n.body}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it in the shell**

In `src/components/layout/DashboardShell.tsx`, import `NotificationBell` and render `<NotificationBell currentUserId={...} />` in the header, immediately before the theme-toggle button. `DashboardShell` does not currently receive the user id — add a `userId: string` prop to its `Props` interface and pass it from `src/app/dashboard/layout.tsx`, which already loads the profile.

- [ ] **Step 3: Ask the user to verify in the browser**

Per the working agreement, do not start a dev server. Ask the user to run `npm run dev`, create an order, and confirm the badge appears — or, if the Playwright MCP server is connected and the dev server is already running, drive it there.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/NotificationBell.tsx src/components/layout/DashboardShell.tsx src/app/dashboard/layout.tsx
git commit -m "feat(notifications): add notification bell to the dashboard shell"
```

---

# Phase 5 — Documentation

### Task 11: Update the context-cache docs

AGENTS.md requires docs in the same commit as code. This is the last task only because it summarises everything above; if you split earlier tasks differently, fold the relevant doc edit into each.

**Files:**
- Modify: `src/app/dashboard/CLAUDE.md`
- Modify: `src/app/dashboard/inventory/SKILL.md`
- Modify: `src/app/dashboard/messages/SKILL.md`
- Modify: `supabase/SKILL.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Dashboard CLAUDE.md**

Document the bell as shell-level wiring: `NotificationBell` in `components/layout/`, `notificationsSlice` at `state.notifications`, the 60-second poll, and that RLS — not client code — decides visibility.

- [ ] **Step 2: Inventory SKILL.md gotcha**

> The low-stock notification trigger (`notify_low_stock`, migration 029) fires **only on the downward crossing** of `reorder_threshold`, not on every stock change. It re-arms automatically when stock rises back above the threshold. If you change `current_stock` handling, check this trigger still sees a meaningful `OLD` row.

- [ ] **Step 3: Messages SKILL.md gotcha**

> `notify_message_received` fires for `direction = 'inbound'` only, so tenant replies do not notify. Its `actor_id` is `NULL` because the actor is an external buyer — `isUnread()` treats null-actor notifications as always unread.

- [ ] **Step 4: supabase/SKILL.md**

Add `027`, `028`, `029` to the file-map/apply-status table. Record that `010` previously hardcoded `tenant_kaufnest` and was fixed, and that `dropship_listings` is still missing from four tenants.

- [ ] **Step 5: AGENTS.md**

Note that `src/app/api/notifications/` is the eBay account-deletion webhook and unrelated to in-app notifications, so nobody adds routes there by mistake.

- [ ] **Step 6: Ask the user to run the full gates**

```bash
npx tsc --noEmit && npm run lint && npx jest && uv run .claude/verifiers/verify_changes.py
```

Report the actual output. Do not claim success without it.

- [ ] **Step 7: Commit and open a PR**

```bash
git add -A
git commit -m "docs(notifications): update feature docs for the notification bell"
git push -u origin feat/notifications
```

Then open a PR against `main` — branch protection rejects direct pushes.

---

## Known follow-ups (deliberately not in this plan)

- **`dropship_listings` is missing from 4 of 5 tenants.** Unrelated to notifications; reconciling it risks the dropshipping feature. Needs its own task.
- **There is still no migration ledger.** This plan reconciles today's drift but does nothing to stop it recurring. A `schema_migrations` table per tenant, or adopting the Supabase CLI's migration tracking, would.
- **Email and push notifications.** The schema supports them (`type` + `payload` are channel-agnostic), but they need an email provider, a `notification_preferences` table, a `notification_deliveries` table, and cron — none of which exist.
- **Notification retention.** Nothing prunes `notifications`. A busy tenant will accumulate rows indefinitely; consider a retention policy before this matters.
