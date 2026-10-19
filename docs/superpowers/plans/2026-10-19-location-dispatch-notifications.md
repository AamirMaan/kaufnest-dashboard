# Location Dispatchers & Dispatch Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each warehouse location gets one dispatcher; when an order first has both a linked inventory product and a fulfillment location, that dispatcher receives an email, a bell notification, and a persistent dashboard banner until the order leaves `pending`/`processing`.

**Architecture:** A Postgres BEFORE trigger on `sales` sets a once-only `dispatch_notified_at` flag on `NEW`; an AFTER trigger writes a per-user `notifications` row and a `dispatch_email_outbox` row. A server route drains the outbox through nodemailer (Mailgun SMTP). A shell-level `DispatchBanner` reads a `my_dispatch_queue()` RPC and also pings the flush route (debounced) whenever the sales slice records a write.

**Tech Stack:** Next.js App Router (this repo's version — see `node_modules/next/dist/docs/`), Supabase (per-tenant schemas, RLS, plpgsql), Redux Toolkit, nodemailer, Jest.

**Spec:** `docs/superpowers/specs/2026-10-19-location-dispatch-notifications-design.md`

## Global Constraints

- Business plan only: everything is inert unless `inventory_settings.advanced_enabled` is true; client UI gates on `hasAdvancedInventory(ent)` / `useAdvancedInventory().active`.
- Never query `public.*`; schema always from `user.app_metadata.tenant_schema`; tenant DDL only through an installer run by `run_on_all_tenant_schemas` + `provision_tenant_schema()` (2-places rule).
- Inside `format($sql$ … $sql$, schema_name)` strings never write a literal percent sign.
- Server-only modules (`src/lib/email/`, `src/lib/dispatch/`) are never imported from a `"use client"` file; SMTP env vars are non-`NEXT_PUBLIC_`.
- Never return a raw Postgres/SMTP error to the client.
- Open statuses: exactly `pending`, `processing` (compared with `lower(status)`).
- Sender: `noreply@mg.boughtopia.com` via `SMTP_FROM`; env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- Notification type string: `inventory.dispatch_assigned`, category `inventory`.
- UI: atoms from `src/components/ui/*`, tokens only (`--color-warning-bg`, `--color-warning-text`, …), `lucide-react` icons, every mutation toasts on success and failure.
- Run focused tests only (`npx jest <path>`); don't run `tsc`/`lint` by hand (pre-commit does). Don't start the dev server.
- Every commit that changes a feature updates that feature's `CLAUDE.md`/`SKILL.md` in the same commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `feat/location-dispatch-notifications` (already created, spec committed).

---

### Task 1: Database — migration 057 + 055 policy update + 005 wiring

**Files:**
- Create: `supabase/migrations/057_location_dispatchers.sql`
- Modify: `supabase/migrations/055_section_permissions.sql` (`notification_section` ~line 148; `notifications_select` ~line 320)
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (~line 1441–1450, between step 9 and step 10)
- Create: `supabase/verify/057_location_dispatchers_check.sql`
- Modify: `supabase/SKILL.md` (file-map table row for 057; note 055 edited), `supabase/CLAUDE.md` (migration entry)

**Interfaces:**
- Produces (per tenant schema):
  - `stock_locations.dispatcher_id uuid NULL`
  - `sales.dispatch_notified_at timestamptz NULL`
  - `notifications.recipient_user_id uuid NULL`
  - table `dispatch_email_outbox(id, sale_id, recipient_user_id, created_at, claimed_at, sent_at, attempts, last_error)` — service_role only
  - RPC `claim_dispatch_emails(p_limit int)` → rows `{ outbox_id uuid, sale_id uuid, recipient_email text, recipient_name text, recipient_active boolean, location_name text, product_name text, quantity int, platform text, marketplace text, external_order_id text, order_date date, buyer_name text, shipping_address_line1 text, shipping_address_line2 text, shipping_city text, shipping_state text, shipping_postal_code text, shipping_country text }` — service_role only
  - RPC `my_dispatch_queue()` → rows `{ location_id uuid, location_name text, open_count int }` — authenticated
  - `get_sales_summary(p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text, p_marketplace text DEFAULT NULL, p_connection_id text DEFAULT NULL, p_location_id text DEFAULT NULL)` — same output columns as 056

- [ ] **Step 1: Edit 055 `notification_section`** — add the dispatch type mapping:

```sql
    CREATE OR REPLACE FUNCTION %1$I.notification_section(p_type text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $f$
      SELECT CASE p_type
        WHEN 'sale.created' THEN 'orders'
        WHEN 'purchase.created' THEN 'purchases'
        WHEN 'message.received' THEN 'messages'
        WHEN 'inventory.dispatch_assigned' THEN 'orders'
        ELSE NULL END
    $f$$q$, s);
```

- [ ] **Step 2: Edit 055 `notifications_select`** — replace the existing `IF to_regclass(format('%I.notifications', s)) IS NOT NULL THEN … END IF;` block with:

```sql
  IF to_regclass(format('%I.notifications', s)) IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = s AND table_name = 'notifications'
                 AND column_name = 'recipient_user_id') THEN
      -- 057: a row addressed to one user (recipient_user_id) is visible to
      -- that user regardless of visible_to_roles. Same section check.
      EXECUTE format($q$CREATE POLICY notifications_select ON %1$I.notifications FOR SELECT
        USING (%1$I.is_tenant_member()
               AND (%1$I.current_user_role() = ANY(visible_to_roles)
                    OR recipient_user_id = auth.uid())
               AND (%1$I.notification_section(type) IS NULL
                    OR %1$I.current_user_access(%1$I.notification_section(type)) >= 1))$q$, s);
    ELSE
      EXECUTE format($q$CREATE POLICY notifications_select ON %1$I.notifications FOR SELECT
        USING (%1$I.is_tenant_member()
               AND %1$I.current_user_role() = ANY(visible_to_roles)
               AND (%1$I.notification_section(type) IS NULL
                    OR %1$I.current_user_access(%1$I.notification_section(type)) >= 1))$q$, s);
    END IF;
  END IF;
```

Also append to 055's header comment: `-- 2026-10-19: notifications_select gains a recipient_user_id disjunct (057) when that column exists; notification_section maps inventory.dispatch_assigned → orders. Re-apply 055 before 057.`

- [ ] **Step 3: Create `supabase/migrations/057_location_dispatchers.sql`**

```sql
-- supabase/migrations/057_location_dispatchers.sql
-- ============================================================
-- 057 — Location dispatchers & dispatch notifications (Business plan)
-- Design: docs/superpowers/specs/2026-10-19-location-dispatch-notifications-design.md
--
-- Defines public.install_location_dispatchers(schema_name) — idempotent,
-- one tenant schema at a time — and runs it on every tenant. Also called by
-- provision_tenant_schema() (005) between install_advanced_inventory and
-- install_section_permissions, guarded by to_regprocedure.
--
-- APPLY ORDER: 056 → re-apply 055 (adds the recipient disjunct to
-- notifications_select) → this file → re-apply 005.
--
-- Trigger design: sales_dispatch_flag (BEFORE) sets NEW.dispatch_notified_at;
-- sales_dispatch_notify (AFTER) writes the notification + outbox rows. The
-- flag is NEVER written by a second UPDATE from the AFTER trigger — that
-- would re-fire 047's inv_sale_* ledger triggers. sales_dispatch_flag sorts
-- after inv_sale_before_write (triggers fire alphabetically), so it sees the
-- fulfillment_location_id that trigger defaults from platform/tenant defaults.
--
-- RULE for editing: inside format($sql$ … $sql$, schema_name) strings never
-- write a literal percent sign — format() consumes it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.install_location_dispatchers(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $inst$
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;
  IF to_regclass(format('%I.stock_locations', schema_name)) IS NULL
     OR to_regclass(format('%I.notifications', schema_name)) IS NULL THEN
    RETURN;
  END IF;

  -- ── 1. Columns, outbox table ──────────────────────────────
  EXECUTE format($sql$
    ALTER TABLE %1$I.stock_locations
      ADD COLUMN IF NOT EXISTS dispatcher_id uuid REFERENCES %1$I.profiles(id) ON DELETE SET NULL;
    ALTER TABLE %1$I.sales
      ADD COLUMN IF NOT EXISTS dispatch_notified_at timestamptz;
    ALTER TABLE %1$I.notifications
      ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES %1$I.profiles(id) ON DELETE CASCADE;

    CREATE INDEX IF NOT EXISTS notifications_recipient_idx
      ON %1$I.notifications (recipient_user_id, created_at DESC)
      WHERE recipient_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS sales_fulfillment_location_idx
      ON %1$I.sales (fulfillment_location_id)
      WHERE fulfillment_location_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS %1$I.dispatch_email_outbox (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id           uuid NOT NULL REFERENCES %1$I.sales(id) ON DELETE CASCADE,
      recipient_user_id uuid NOT NULL REFERENCES %1$I.profiles(id) ON DELETE CASCADE,
      created_at        timestamptz NOT NULL DEFAULT now(),
      claimed_at        timestamptz,
      sent_at           timestamptz,
      attempts          int NOT NULL DEFAULT 0,
      last_error        text
    );
    CREATE INDEX IF NOT EXISTS dispatch_email_outbox_pending_idx
      ON %1$I.dispatch_email_outbox (created_at) WHERE sent_at IS NULL;

    -- Service role only: no policies, no client grants.
    ALTER TABLE %1$I.dispatch_email_outbox ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON %1$I.dispatch_email_outbox FROM anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON %1$I.dispatch_email_outbox TO service_role;
  $sql$, schema_name);

  -- ── 2. Triggers ───────────────────────────────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.sales_dispatch_flag()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = %1$I, public
    AS $f$
    DECLARE
      v_dispatcher uuid;
    BEGIN
      -- Clients can never set or clear the flag themselves.
      IF TG_OP = 'INSERT' THEN
        NEW.dispatch_notified_at := NULL;
      ELSE
        NEW.dispatch_notified_at := OLD.dispatch_notified_at;
        -- Moved to another warehouse: that warehouse's dispatcher must be told.
        IF OLD.fulfillment_location_id IS NOT NULL
           AND NEW.fulfillment_location_id IS DISTINCT FROM OLD.fulfillment_location_id THEN
          NEW.dispatch_notified_at := NULL;
        END IF;
      END IF;

      IF NEW.dispatch_notified_at IS NULL
         AND NEW.product_id IS NOT NULL
         AND NEW.fulfillment_location_id IS NOT NULL
         AND lower(coalesce(NEW.status, '')) IN ('pending', 'processing')
         AND coalesce((SELECT advanced_enabled FROM inventory_settings WHERE id), false) THEN
        SELECT l.dispatcher_id INTO v_dispatcher
          FROM stock_locations l
          JOIN profiles p ON p.id = l.dispatcher_id
         WHERE l.id = NEW.fulfillment_location_id
           AND p.status = 'active';
        IF v_dispatcher IS NOT NULL THEN
          NEW.dispatch_notified_at := now();
        END IF;
      END IF;
      RETURN NEW;
    END;
    $f$;

    CREATE OR REPLACE FUNCTION %1$I.sales_dispatch_notify()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = %1$I, public
    AS $f$
    DECLARE
      v_dispatcher uuid;
      v_location   text;
    BEGIN
      IF NEW.dispatch_notified_at IS NULL
         OR (TG_OP = 'UPDATE' AND NEW.dispatch_notified_at IS NOT DISTINCT FROM OLD.dispatch_notified_at) THEN
        RETURN NULL;
      END IF;

      SELECT dispatcher_id, name INTO v_dispatcher, v_location
        FROM stock_locations WHERE id = NEW.fulfillment_location_id;
      IF v_dispatcher IS NULL THEN
        RETURN NULL;
      END IF;

      -- Notifications must never block a core business write (029's rule).
      BEGIN
        INSERT INTO notifications
          (type, category, entity_type, entity_id, title, body, link,
           payload, actor_id, visible_to_roles, required_permission, recipient_user_id)
        VALUES (
          'inventory.dispatch_assigned', 'inventory', 'sale', NEW.id,
          'Order to dispatch from ' || v_location,
          NEW.quantity || ' × ' || NEW.product_name || ' — ' || NEW.platform,
          '/dashboard/sales/' || NEW.id,
          jsonb_build_object(
            'location_id',   NEW.fulfillment_location_id,
            'location_name', v_location,
            'quantity',      NEW.quantity,
            'platform',      NEW.platform
          ),
          auth.uid(),
          '{}'::text[],
          NULL,
          v_dispatcher
        );
      EXCEPTION WHEN others THEN
        NULL;
      END;

      BEGIN
        INSERT INTO dispatch_email_outbox (sale_id, recipient_user_id)
          VALUES (NEW.id, v_dispatcher);
      EXCEPTION WHEN others THEN
        NULL;
      END;
      RETURN NULL;
    END;
    $f$;

    DROP TRIGGER IF EXISTS sales_dispatch_flag ON %1$I.sales;
    CREATE TRIGGER sales_dispatch_flag BEFORE INSERT OR UPDATE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.sales_dispatch_flag();
    DROP TRIGGER IF EXISTS sales_dispatch_notify ON %1$I.sales;
    CREATE TRIGGER sales_dispatch_notify AFTER INSERT OR UPDATE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.sales_dispatch_notify();
  $sql$, schema_name);

  -- ── 3. Outbox claim (service role) ────────────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.claim_dispatch_emails(p_limit int)
    RETURNS TABLE (
      outbox_id uuid, sale_id uuid, recipient_email text, recipient_name text,
      recipient_active boolean, location_name text, product_name text, quantity int,
      platform text, marketplace text, external_order_id text, order_date date,
      buyer_name text, shipping_address_line1 text, shipping_address_line2 text,
      shipping_city text, shipping_state text, shipping_postal_code text, shipping_country text
    )
    LANGUAGE sql SECURITY DEFINER
    SET search_path = %1$I
    AS $f$
      WITH claimed AS (
        UPDATE dispatch_email_outbox o
           SET claimed_at = now(), attempts = o.attempts + 1
         WHERE o.id IN (
           SELECT q.id FROM dispatch_email_outbox q
            WHERE q.sent_at IS NULL
              AND q.attempts < 5
              AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '5 minutes')
            ORDER BY q.created_at
            LIMIT greatest(p_limit, 0)
            FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.sale_id, o.recipient_user_id
      )
      SELECT c.id, c.sale_id, p.email, p.full_name, (p.status = 'active'),
             l.name, s.product_name, s.quantity, s.platform, s.marketplace,
             s.external_order_id, s.date, s.buyer_name,
             s.shipping_address_line1, s.shipping_address_line2, s.shipping_city,
             s.shipping_state, s.shipping_postal_code, s.shipping_country
        FROM claimed c
        JOIN sales s    ON s.id = c.sale_id
        JOIN profiles p ON p.id = c.recipient_user_id
        LEFT JOIN stock_locations l ON l.id = s.fulfillment_location_id
    $f$;
  $sql$, schema_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.claim_dispatch_emails(int) FROM PUBLIC, anon, authenticated', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.claim_dispatch_emails(int) TO service_role', schema_name);

  -- ── 4. Banner query (caller's RLS applies) ────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.my_dispatch_queue()
    RETURNS TABLE (location_id uuid, location_name text, open_count int)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = %1$I
    AS $f$
      SELECT l.id, l.name, count(s.id)::int
        FROM stock_locations l
        JOIN sales s ON s.fulfillment_location_id = l.id
       WHERE l.dispatcher_id = auth.uid()
         AND s.product_id IS NOT NULL
         AND lower(s.status) IN ('pending', 'processing')
         AND coalesce((SELECT advanced_enabled FROM inventory_settings WHERE id), false)
       GROUP BY l.id, l.name
       ORDER BY l.name
    $f$;
  $sql$, schema_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.my_dispatch_queue() FROM PUBLIC, anon', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.my_dispatch_queue() TO authenticated', schema_name);

  -- ── 5. get_sales_summary gains trailing p_location_id ─────
  -- Body identical to 056 plus one predicate. The client sends p_location_id
  -- only when set, so pre-057 8-arg resolution keeps working.
  EXECUTE format('DROP FUNCTION IF EXISTS %I.get_sales_summary(date, date, text, text, text, text, text, text)', schema_name);
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.get_sales_summary(
      p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text,
      p_marketplace text DEFAULT NULL,
      p_connection_id text DEFAULT NULL,
      p_location_id text DEFAULT NULL
    )
    RETURNS TABLE (
      currency text, order_count int, gross numeric, vat numeric,
      fees numeric, shipping_charged numeric, excluded_count int, vat_base numeric
    )
    LANGUAGE sql STABLE
    SET search_path = %1$I
    AS $func$
      WITH filtered AS (
        SELECT s.*,
               (p_status IS NOT NULL OR s.status NOT IN ('returned', 'cancelled')) AS counts
        FROM sales s
        WHERE (p_from IS NULL OR s.date >= p_from)
          AND (p_to IS NULL OR s.date <= p_to)
          AND (p_platform IS NULL OR s.platform = p_platform)
          AND (p_currency IS NULL OR s.currency = p_currency)
          AND (p_status IS NULL OR s.status = p_status)
          AND (p_marketplace IS NULL
               OR (p_marketplace = '__unknown__' AND s.marketplace IS NULL)
               OR s.marketplace = p_marketplace)
          AND (p_connection_id IS NULL
               OR (p_connection_id = '__unassigned__' AND s.connection_id IS NULL)
               OR s.connection_id::text = p_connection_id)
          AND (p_location_id IS NULL OR s.fulfillment_location_id::text = p_location_id)
          AND (p_pattern IS NULL
               OR s.product_name ILIKE p_pattern
               OR s.external_order_id ILIKE p_pattern
               OR s.description ILIKE p_pattern)
      )
      SELECT
        f.currency,
        count(*)::int,
        coalesce(sum(f.total_amount) FILTER (WHERE f.counts), 0),
        coalesce(sum(coalesce(f.vat_amount, 0)) FILTER (WHERE f.counts), 0),
        coalesce(sum(coalesce(f.platform_fee, 0) + coalesce(f.advertising_fee, 0) + coalesce(f.shipping_cost, 0))
                 FILTER (WHERE f.counts), 0),
        coalesce(sum(coalesce(f.shipping_charged, 0)) FILTER (WHERE f.counts), 0),
        (count(*) FILTER (WHERE NOT f.counts))::int,
        coalesce(sum(f.total_amount + coalesce(f.shipping_charged, 0) - f.vat_amount)
                 FILTER (WHERE f.counts AND coalesce(f.vat_amount, 0) > 0), 0)
      FROM filtered f
      GROUP BY f.currency
      ORDER BY f.currency;
    $func$;
  $sql$, schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.get_sales_summary(date, date, text, text, text, text, text, text, text) TO authenticated', schema_name);

  -- ── 6. Re-apply section permissions (owns notifications_select) ──
  IF to_regprocedure('public.install_section_permissions(text)') IS NOT NULL THEN
    PERFORM public.install_section_permissions(schema_name);
  END IF;
END;
$inst$;

COMMENT ON FUNCTION public.install_location_dispatchers(text) IS
  'Location dispatchers + dispatch notifications (057). Idempotent; called by 057 and provision_tenant_schema().';
REVOKE ALL ON FUNCTION public.install_location_dispatchers(text) FROM PUBLIC, anon, authenticated;

SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_location_dispatchers('{{schema}}');
$$);
```

Note: the `'5 minutes'` literal contains no percent sign (safe inside `format`). `'×'`/`'—'` are plain UTF-8.

- [ ] **Step 4: Wire into 005** — in `provision_tenant_schema()`, insert between the step-9 block (`install_advanced_inventory`) and the step-10 block (`install_section_permissions`):

```sql
  -- ── 9b. Location dispatchers (057) ────────────────────────
  -- Needs stock_locations (step 9) and notifications. Runs before step 10 so
  -- section permissions rebuild notifications_select with the recipient column.
  IF to_regprocedure('public.install_location_dispatchers(text)') IS NOT NULL THEN
    PERFORM public.install_location_dispatchers(schema_name);
  END IF;
```

- [ ] **Step 5: Create `supabase/verify/057_location_dispatchers_check.sql`** — run manually against Project B after applying; everything rolls back:

```sql
-- Verifies 057 on one tenant. Replace tenant_boughtopia if needed.
-- Requires: advanced inventory enabled, ≥1 product, ≥1 own location, ≥1 active profile.
BEGIN;
SET LOCAL search_path = tenant_boughtopia, public;

WITH loc AS (SELECT id FROM stock_locations WHERE type <> 'dropship' AND is_active LIMIT 1),
     usr AS (SELECT id FROM profiles WHERE status = 'active' LIMIT 1)
UPDATE stock_locations SET dispatcher_id = (SELECT id FROM usr) WHERE id = (SELECT id FROM loc);

INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, currency, date, status, fulfillment_location_id)
SELECT 'other', 'verify-057', (SELECT id FROM products LIMIT 1), 1, 1, 1, 'EUR', current_date, 'pending',
       (SELECT id FROM stock_locations WHERE dispatcher_id IS NOT NULL LIMIT 1)
RETURNING id, dispatch_notified_at;            -- expect dispatch_notified_at NOT NULL

SELECT count(*) AS notif FROM notifications
 WHERE type = 'inventory.dispatch_assigned' AND body LIKE '1 × verify-057%';   -- expect 1
SELECT count(*) AS outbox FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057';         -- expect 1

-- Re-saving must not re-notify:
UPDATE sales SET description = 'touch' WHERE product_name = 'verify-057';
SELECT count(*) AS outbox_after_touch FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057';         -- expect 1
ROLLBACK;
```

- [ ] **Step 6: Update `supabase/SKILL.md`** file-map table: add a `057_location_dispatchers.sql` row ("Location dispatchers, dispatch triggers, outbox, `claim_dispatch_emails`, `my_dispatch_queue`, `get_sales_summary` + `p_location_id`; installer `install_location_dispatchers`; **not applied**; apply order 056 → 055 → 057 → 005"), and note on the 055 row that it was edited 2026-10-19 and needs re-applying. Add a Gotcha: "`notifications_select` is owned by 055 — any new visibility rule goes in 055's installer, never in a later migration, because 055 drops and recreates every notifications policy each run." Add the matching entry to `supabase/CLAUDE.md`'s migration list.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/057_location_dispatchers.sql supabase/migrations/055_section_permissions.sql supabase/migrations/005_tenant_provisioning.sql supabase/verify/057_location_dispatchers_check.sql supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(db): location dispatchers, dispatch triggers and email outbox (057)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Types + bell label

**Files:**
- Modify: `src/types/index.ts` (`StockLocation` ~line 269, `Sale` ~line 185, `NotificationType` ~line 346, `Notification` ~line 356)
- Modify: `src/lib/utils/notifications.ts` (`NOTIFICATION_LABELS` ~line 70)
- Test: `src/lib/utils/notifications.test.ts` (extend)

**Interfaces:**
- Produces: `StockLocation.dispatcher_id: string | null`; `Sale.dispatch_notified_at?: string | null`; `NotificationType` includes `"inventory.dispatch_assigned"`; `Notification.recipient_user_id?: string | null`; `NOTIFICATION_LABELS["inventory.dispatch_assigned"] === "Dispatch"`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/utils/notifications.test.ts`:

```ts
import { NOTIFICATION_LABELS } from "./notifications";

describe("NOTIFICATION_LABELS", () => {
  it("labels dispatch notifications", () => {
    expect(NOTIFICATION_LABELS["inventory.dispatch_assigned"]).toBe("Dispatch");
  });
});
```

(If the file already imports `NOTIFICATION_LABELS`, reuse that import instead of adding a duplicate.)

- [ ] **Step 2: Run it** — `npx jest src/lib/utils/notifications.test.ts` → FAIL (type error / undefined).

- [ ] **Step 3: Implement**

In `src/types/index.ts`:

```ts
export interface StockLocation {
  id: string;
  name: string;
  type: StockLocationType;
  is_active: boolean;
  /** 057: the user emailed/notified when an order lands here. Null = nobody. */
  dispatcher_id: string | null;
  created_by: string | null;
  created_at: string;
}
```

In `Sale`, next to `fulfillment_location_id`:

```ts
  /** 057: set once by the sales_dispatch_flag trigger when the dispatcher was notified. Read-only. */
  dispatch_notified_at?: string | null;
```

`NotificationType` gains `| "inventory.dispatch_assigned"`. `Notification` gains:

```ts
  /** 057: when set, only this user sees the row (plus visible_to_roles, normally empty for these). */
  recipient_user_id?: string | null;
```

In `src/lib/utils/notifications.ts` add `"inventory.dispatch_assigned": "Dispatch",` to `NOTIFICATION_LABELS`.

Because `dispatcher_id` is a required field, find every object literal typed as `StockLocation` in tests/fixtures (`grep -rn "StockLocation" src --include=*.test.ts`, e.g. `inventory/_lib/advancedInventory.test.ts`, `sales/_components/fulfillmentLocation.test.ts`) and add `dispatcher_id: null` so the pre-commit `tsc` passes.

- [ ] **Step 4: Run** `npx jest src/lib/utils/notifications.test.ts dashboard/inventory dashboard/sales` → PASS.

- [ ] **Step 5: Commit** (docs: add a line to `src/app/dashboard/CLAUDE.md`'s NotificationBell paragraph: "Dispatch notifications (057) are addressed to one user via `recipient_user_id`; RLS still decides visibility.")

```bash
git add src/types/index.ts src/lib/utils/notifications.ts src/lib/utils/notifications.test.ts src/app/dashboard/CLAUDE.md
git commit -m "feat(types): dispatcher, dispatch flag and per-user notification fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Email builder + SMTP transport

**Files:**
- Create: `src/lib/email/dispatchEmail.ts`, `src/lib/email/dispatchEmail.test.ts`
- Create: `src/lib/email/smtp.ts`
- Create: `src/lib/email/SKILL.md`
- Modify: `package.json` (deps), `.env.local.example`

**Interfaces:**
- Produces:
  - `interface DispatchEmailInput { saleId: string; productName: string; quantity: number; platform: string; marketplace: string | null; externalOrderId: string | null; orderDate: string; buyerName: string | null; address: (string | null)[]; locationName: string; recipientName: string | null; appUrl: string }`
  - `buildDispatchEmail(input: DispatchEmailInput): { subject: string; html: string; text: string }`
  - `escapeHtml(s: string): string`
  - `isSmtpConfigured(): boolean`
  - `sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<void>`

- [ ] **Step 1: Install dependency**

```bash
npm install nodemailer && npm install -D @types/nodemailer
```

- [ ] **Step 2: Write the failing test** `src/lib/email/dispatchEmail.test.ts`:

```ts
import { buildDispatchEmail, escapeHtml, type DispatchEmailInput } from "./dispatchEmail";

const base: DispatchEmailInput = {
  saleId: "sale-1",
  productName: "Blue Mug",
  quantity: 2,
  platform: "ebay",
  marketplace: "ebay.de",
  externalOrderId: "12-34:56",
  orderDate: "2026-10-19",
  buyerName: "Jane Buyer",
  address: ["Main St 1", null, "10115 Berlin", "DE"],
  locationName: "Berlin Warehouse",
  recipientName: "Sam",
  appUrl: "https://app.boughtopia.com/",
};

describe("buildDispatchEmail", () => {
  it("builds subject, text and html with the order link", () => {
    const m = buildDispatchEmail(base);
    expect(m.subject).toBe("Dispatch needed: 2 × Blue Mug (Berlin Warehouse)");
    expect(m.text).toContain("Hi Sam,");
    expect(m.text).toContain("https://app.boughtopia.com/dashboard/sales/sale-1");
    expect(m.text).toContain("Main St 1");
    expect(m.text).not.toContain("null");
    expect(m.html).toContain('href="https://app.boughtopia.com/dashboard/sales/sale-1"');
  });

  it("escapes hostile values in html", () => {
    const m = buildDispatchEmail({ ...base, productName: '<script>alert("x")</script>', buyerName: "A & B" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A &amp; B");
  });

  it("falls back when optional fields are missing", () => {
    const m = buildDispatchEmail({ ...base, recipientName: null, buyerName: null, address: [], marketplace: null, externalOrderId: null });
    expect(m.text).toContain("Hi,");
    expect(m.text).not.toContain("Ship to");
  });
});

describe("escapeHtml", () => {
  it("escapes the five html-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
```

- [ ] **Step 3: Run** `npx jest src/lib/email` → FAIL (module not found).

- [ ] **Step 4: Implement `src/lib/email/dispatchEmail.ts`**

```ts
/**
 * Pure builder for the "order to dispatch" email (057). No I/O — the outbox
 * flusher (`lib/dispatch/flushOutbox.ts`) feeds it a claimed outbox row.
 * Every interpolated value goes through escapeHtml in the html part.
 */
export interface DispatchEmailInput {
  saleId: string;
  productName: string;
  quantity: number;
  platform: string;
  marketplace: string | null;
  externalOrderId: string | null;
  orderDate: string;
  buyerName: string | null;
  /** Address lines in display order; null/blank entries are dropped. */
  address: (string | null)[];
  locationName: string;
  recipientName: string | null;
  appUrl: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDispatchEmail(i: DispatchEmailInput): { subject: string; html: string; text: string } {
  const link = `${i.appUrl.replace(/\/+$/, "")}/dashboard/sales/${encodeURIComponent(i.saleId)}`;
  const greeting = i.recipientName ? `Hi ${i.recipientName},` : "Hi,";
  const channel = i.marketplace ?? i.platform;
  const shipTo = [i.buyerName, ...i.address].filter((l): l is string => !!l && l.trim() !== "");

  const rows: [string, string][] = [
    ["Item", `${i.quantity} × ${i.productName}`],
    ["From", i.locationName],
    ["Channel", channel],
    ...(i.externalOrderId ? ([["Order", i.externalOrderId]] as [string, string][]) : []),
    ["Order date", i.orderDate],
  ];

  const subject = `Dispatch needed: ${i.quantity} × ${i.productName} (${i.locationName})`;

  const text = [
    greeting,
    "",
    `A new order is ready to dispatch from ${i.locationName}.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(shipTo.length ? ["", "Ship to:", ...shipTo] : []),
    "",
    `Open the order: ${link}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
<p>${escapeHtml(greeting)}</p>
<p>A new order is ready to dispatch from <strong>${escapeHtml(i.locationName)}</strong>.</p>
<table cellpadding="4" style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="color:#555">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`)
    .join("")}</table>
${shipTo.length ? `<p style="margin-top:16px"><span style="color:#555">Ship to</span><br>${shipTo.map(escapeHtml).join("<br>")}</p>` : ""}
<p style="margin-top:24px"><a href="${escapeHtml(link)}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open order</a></p>
</body></html>`;

  return { subject, html, text };
}
```

- [ ] **Step 5: Run** `npx jest src/lib/email` → PASS.

- [ ] **Step 6: Implement `src/lib/email/smtp.ts`** (server-only; no test — thin I/O wrapper):

```ts
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Server-only SMTP transport (Mailgun, same account Supabase auth uses).
 * Never import from a "use client" file. Lazily created and cached per
 * server instance; isSmtpConfigured() lets callers no-op in dev.
 */
let transporter: Transporter | null = null;

export function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  await getTransporter().sendMail({ from: process.env.SMTP_FROM, ...msg });
}
```

- [ ] **Step 7: `.env.local.example`** — append:

```
# ── Transactional email (dispatch notifications, 057) ──
# Same Mailgun SMTP credentials Supabase Auth uses. Server-only — never NEXT_PUBLIC_.
# Leave unset locally: the flush route then no-ops and emails stay queued.
SMTP_HOST=smtp.eu.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.boughtopia.com
SMTP_PASS=
SMTP_FROM="Boughtopia <noreply@mg.boughtopia.com>"
```

- [ ] **Step 8: Write `src/lib/email/SKILL.md`**

```markdown
# lib/email — transactional email (server-only)

- `smtp.ts` — nodemailer transport from `SMTP_*` env; `isSmtpConfigured()`, `sendMail()`.
- `dispatchEmail.ts` (+ test) — pure `buildDispatchEmail()` for dispatch notifications (057).

## Adding an email
1. Pure builder `<name>Email.ts` returning `{ subject, html, text }`, every value through `escapeHtml`, colocated test.
2. Send via `sendMail()` from server code only.

## Gotchas
- Never import from a `"use client"` file (verifier blocks it; env vars are server-only).
- `secure` is derived from port 465; 587 uses STARTTLS.
- Callers must check `isSmtpConfigured()` and no-op, so dev without SMTP never errors.
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .env.local.example src/lib/email
git commit -m "feat(email): nodemailer SMTP transport and dispatch email builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Outbox processor + flush route + client trigger

**Files:**
- Create: `src/lib/dispatch/processOutbox.ts`, `src/lib/dispatch/processOutbox.test.ts`
- Create: `src/lib/dispatch/flushOutbox.ts`
- Create: `src/lib/dispatch/SKILL.md`
- Create: `src/app/api/dispatch/flush/route.ts`
- Create: `src/lib/utils/dispatchFlush.ts`
- Modify: `AGENTS.md` ("New shared code" list)

**Interfaces:**
- Consumes: `claim_dispatch_emails` RPC (Task 1); `buildDispatchEmail`, `isSmtpConfigured`, `sendMail` (Task 3); `requireSectionAccess` (`src/lib/permissions/requireSectionAccess.ts`); `createServiceClientForTenant` (`src/lib/supabase/server.ts`).
- Produces:
  - `interface ClaimedDispatchEmail` (mirrors the RPC row, snake_case)
  - `interface OutboxDeps { claim(limit: number): Promise<ClaimedDispatchEmail[]>; markSent(id: string, note: string | null): Promise<void>; markFailed(id: string, error: string): Promise<void>; send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>; appUrl: string }`
  - `processOutbox(deps: OutboxDeps, limit?: number): Promise<{ sent: number; failed: number; skipped: number }>`
  - `flushDispatchOutbox(schema: string): Promise<{ sent: number; failed: number; skipped: number; configured: boolean }>`
  - `POST /api/dispatch/flush` → `{ sent, failed }`
  - client-safe `requestDispatchFlush(): void`

- [ ] **Step 1: Write the failing test** `src/lib/dispatch/processOutbox.test.ts`:

```ts
import { processOutbox, type ClaimedDispatchEmail, type OutboxDeps } from "./processOutbox";

function row(over: Partial<ClaimedDispatchEmail> = {}): ClaimedDispatchEmail {
  return {
    outbox_id: "o1", sale_id: "s1", recipient_email: "sam@example.com", recipient_name: "Sam",
    recipient_active: true, location_name: "Berlin", product_name: "Mug", quantity: 1,
    platform: "ebay", marketplace: null, external_order_id: null, order_date: "2026-10-19",
    buyer_name: null, shipping_address_line1: null, shipping_address_line2: null,
    shipping_city: null, shipping_state: null, shipping_postal_code: null, shipping_country: null,
    ...over,
  };
}

function deps(rows: ClaimedDispatchEmail[], send: OutboxDeps["send"] = jest.fn().mockResolvedValue(undefined)) {
  return {
    claim: jest.fn().mockResolvedValue(rows),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    send,
    appUrl: "https://app.example",
  };
}

describe("processOutbox", () => {
  it("sends each claimed row and marks it sent", async () => {
    const d = deps([row(), row({ outbox_id: "o2", sale_id: "s2" })]);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(d.claim).toHaveBeenCalledWith(50);
    expect(d.send).toHaveBeenCalledTimes(2);
    expect((d.send as jest.Mock).mock.calls[0][0].to).toBe("sam@example.com");
    expect(d.markSent).toHaveBeenCalledWith("o1", null);
  });

  it("skips inactive recipients and missing emails without sending", async () => {
    const d = deps([row({ recipient_active: false }), row({ outbox_id: "o2", recipient_email: null })]);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 0, failed: 0, skipped: 2 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markSent).toHaveBeenCalledWith("o1", "skipped: recipient inactive");
    expect(d.markSent).toHaveBeenCalledWith("o2", "skipped: no email");
  });

  it("records a failure and keeps going", async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error("smtp down")).mockResolvedValue(undefined);
    const d = deps([row(), row({ outbox_id: "o2" })], send);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(d.markFailed).toHaveBeenCalledWith("o1", "smtp down");
    expect(d.markSent).toHaveBeenCalledWith("o2", null);
  });

  it("truncates long error messages", async () => {
    const send = jest.fn().mockRejectedValue(new Error("x".repeat(2000)));
    const d = deps([row()], send);
    await processOutbox(d);
    expect((d.markFailed as jest.Mock).mock.calls[0][1]).toHaveLength(500);
  });
});
```

- [ ] **Step 2: Run** `npx jest src/lib/dispatch` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/dispatch/processOutbox.ts`**

```ts
import { buildDispatchEmail } from "@/lib/email/dispatchEmail";

/** One row of the claim_dispatch_emails RPC (057). */
export interface ClaimedDispatchEmail {
  outbox_id: string;
  sale_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  recipient_active: boolean;
  location_name: string | null;
  product_name: string;
  quantity: number;
  platform: string;
  marketplace: string | null;
  external_order_id: string | null;
  order_date: string;
  buyer_name: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
}

export interface OutboxDeps {
  claim(limit: number): Promise<ClaimedDispatchEmail[]>;
  markSent(id: string, note: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
  appUrl: string;
}

const MAX_ERROR = 500;

/** I/O-free core of the flush: claim → send → mark. Tested with fakes. */
export async function processOutbox(deps: OutboxDeps, limit = 50) {
  const rows = await deps.claim(limit);
  let sent = 0, failed = 0, skipped = 0;

  for (const r of rows) {
    if (!r.recipient_active) { await deps.markSent(r.outbox_id, "skipped: recipient inactive"); skipped++; continue; }
    if (!r.recipient_email) { await deps.markSent(r.outbox_id, "skipped: no email"); skipped++; continue; }

    const msg = buildDispatchEmail({
      saleId: r.sale_id,
      productName: r.product_name,
      quantity: r.quantity,
      platform: r.platform,
      marketplace: r.marketplace,
      externalOrderId: r.external_order_id,
      orderDate: r.order_date,
      buyerName: r.buyer_name,
      address: [
        r.shipping_address_line1,
        r.shipping_address_line2,
        [r.shipping_postal_code, r.shipping_city, r.shipping_state].filter(Boolean).join(" ") || null,
        r.shipping_country,
      ],
      locationName: r.location_name ?? "your location",
      recipientName: r.recipient_name,
      appUrl: deps.appUrl,
    });

    try {
      await deps.send({ to: r.recipient_email, ...msg });
      await deps.markSent(r.outbox_id, null);
      sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await deps.markFailed(r.outbox_id, message.slice(0, MAX_ERROR));
      failed++;
    }
  }
  return { sent, failed, skipped };
}
```

- [ ] **Step 4: Run** `npx jest src/lib/dispatch` → PASS.

- [ ] **Step 5: Implement `src/lib/dispatch/flushOutbox.ts`** (server-only wiring, no unit test — covered by `processOutbox` tests):

```ts
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { isSmtpConfigured, sendMail } from "@/lib/email/smtp";
import { processOutbox, type ClaimedDispatchEmail } from "./processOutbox";

/**
 * Drains one tenant's dispatch_email_outbox (057). Server-only. Service role:
 * the outbox has no client grants. No-ops when SMTP isn't configured, so dev
 * never errors and rows stay pending until a configured environment flushes.
 */
export async function flushDispatchOutbox(schema: string) {
  if (!isSmtpConfigured()) return { sent: 0, failed: 0, skipped: 0, configured: false };

  const db = createServiceClientForTenant(schema);
  const result = await processOutbox({
    async claim(limit) {
      const { data, error } = await db.rpc("claim_dispatch_emails", { p_limit: limit });
      if (error) throw new Error(`claim_dispatch_emails: ${error.message}`);
      return (data ?? []) as ClaimedDispatchEmail[];
    },
    async markSent(id, note) {
      await db.from("dispatch_email_outbox").update({ sent_at: new Date().toISOString(), last_error: note }).eq("id", id);
    },
    async markFailed(id, error) {
      await db.from("dispatch_email_outbox").update({ last_error: error, claimed_at: null }).eq("id", id);
    },
    send: sendMail,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "",
  });
  return { ...result, configured: true };
}
```

- [ ] **Step 6: Implement `src/app/api/dispatch/flush/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireSectionAccess } from "@/lib/permissions/requireSectionAccess";
import { flushDispatchOutbox } from "@/lib/dispatch/flushOutbox";

/**
 * Drains the caller's own tenant's dispatch email queue (057). Any user who
 * can see Orders may trigger it — it only sends emails the DB trigger already
 * queued, and returns counts. Called fire-and-forget by DispatchBanner.
 */
export async function POST() {
  const auth = await requireSectionAccess("orders", 1);
  if (auth.error) return auth.error;

  try {
    const { sent, failed } = await flushDispatchOutbox(auth.context.tenantSchema);
    return NextResponse.json({ sent, failed });
  } catch (e) {
    console.error("[dispatch/flush] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not send dispatch emails" }, { status: 500 });
  }
}
```

- [ ] **Step 7: Implement `src/lib/utils/dispatchFlush.ts`** (client-safe):

```ts
/**
 * Fire-and-forget nudge for POST /api/dispatch/flush (057). Safe in client
 * components: no server imports. Failures are ignored — the outbox persists
 * and the next nudge retries.
 */
export function requestDispatchFlush(): void {
  void fetch("/api/dispatch/flush", { method: "POST" }).catch(() => undefined);
}
```

- [ ] **Step 8: Write `src/lib/dispatch/SKILL.md`**

```markdown
# lib/dispatch — dispatch email outbox (server-only, 057)

- `processOutbox.ts` (+ test) — pure claim → send → mark loop over injected deps.
- `flushOutbox.ts` — wires it to the service-role tenant client + `lib/email/smtp`.
- Route: `src/app/api/dispatch/flush/route.ts` (`requireSectionAccess("orders", 1)`).
- Client nudge: `src/lib/utils/dispatchFlush.ts` (`requestDispatchFlush`), called by `components/layout/DispatchBanner.tsx`.

## Gotchas
- Rows are queued ONLY by the `sales_dispatch_notify` trigger (057). Never insert outbox rows from app code.
- `claim_dispatch_emails` uses `FOR UPDATE SKIP LOCKED` + a 5-minute claim lease, so concurrent flushes never double-send; `attempts < 5` caps retries.
- A failed send clears `claimed_at` so the next flush retries; a skip (inactive recipient / no email) marks `sent_at` with a `skipped:` note.
- The integrations import route does NOT flush: synced orders are inserted with `product_id: null`, so they never queue at insert time.
```

- [ ] **Step 9: Update `AGENTS.md`** "New shared code" list — add:

```markdown
- `src/lib/email/` — server-only nodemailer SMTP transport (`SMTP_*` env, Mailgun) and pure email builders. See its `SKILL.md`.
- `src/lib/dispatch/` + `src/app/api/dispatch/flush/` — dispatch email outbox drain (057). Rows are queued by the `sales_dispatch_notify` trigger only; `DispatchBanner` nudges the flush via `src/lib/utils/dispatchFlush.ts`.
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/dispatch src/app/api/dispatch src/lib/utils/dispatchFlush.ts AGENTS.md
git commit -m "feat(dispatch): outbox processor and flush route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dispatcher field on locations

**Files:**
- Create: `src/app/dashboard/inventory/_lib/dispatcherOptions.ts`, `src/app/dashboard/inventory/_lib/dispatcherOptions.test.ts`
- Modify: `src/app/dashboard/inventory/_components/LocationModal.tsx`
- Modify: `src/app/dashboard/inventory/_components/LocationsTab.tsx` (columns ~line 162)
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`

**Interfaces:**
- Consumes: `StockLocation.dispatcher_id` (Task 2); `ROLE_DEFAULTS` (`src/lib/permissions/sections.ts`); `state.users.items: Profile[]`.
- Produces: `dispatcherOptions(users: Profile[], currentId: string | null): { value: string; label: string }[]`; `dispatcherName(users: Profile[], id: string | null): string | null`.

- [ ] **Step 1: Write the failing test** `dispatcherOptions.test.ts`:

```ts
import { dispatcherOptions, dispatcherName } from "./dispatcherOptions";
import type { Profile } from "@/types";

function p(over: Partial<Profile>): Profile {
  return {
    id: "u", email: "u@x.com", full_name: "User", role: "admin", permission_overrides: [],
    status: "active", created_at: "2026-01-01", ...over,
  } as Profile;
}

describe("dispatcherOptions", () => {
  const users = [
    p({ id: "a", full_name: "Zoe", role: "accountant" }),
    p({ id: "b", full_name: "Adam", role: "admin" }),
    p({ id: "c", full_name: "Gone", status: "deactivated" }),
    p({ id: "d", full_name: "", email: "noname@x.com" }),
  ];

  it("lists active users sorted by name, falling back to email", () => {
    expect(dispatcherOptions(users, null)).toEqual([
      { value: "b", label: "Adam" },
      { value: "d", label: "noname@x.com" },
      { value: "a", label: "Zoe" },
    ]);
  });

  it("keeps the current dispatcher even if deactivated", () => {
    expect(dispatcherOptions(users, "c")).toContainEqual({ value: "c", label: "Gone (deactivated)" });
  });
});

describe("dispatcherName", () => {
  it("resolves a name or null", () => {
    expect(dispatcherName([p({ id: "b", full_name: "Adam" })], "b")).toBe("Adam");
    expect(dispatcherName([], "b")).toBeNull();
    expect(dispatcherName([], null)).toBeNull();
  });
});
```

Before writing, open `src/types/index.ts`'s `Profile` and make the `p()` defaults include every required field it declares (cast is a fallback only).

- [ ] **Step 2: Run** `npx jest dashboard/inventory/_lib/dispatcherOptions` → FAIL.

- [ ] **Step 3: Implement `dispatcherOptions.ts`**

```ts
import { ROLE_DEFAULTS } from "@/lib/permissions/sections";
import type { Profile } from "@/types";

/**
 * Users who may be a location's dispatcher (057): active, and whose role
 * default can view Orders. Per-user section exceptions are server-side and
 * not loaded here — a dispatcher whose exception removes Orders just sees an
 * empty banner (my_dispatch_queue runs under RLS). The current dispatcher is
 * always kept so editing a location never silently drops it.
 */
export function dispatcherOptions(users: Profile[], currentId: string | null) {
  const label = (u: Profile) => u.full_name?.trim() || u.email;
  const eligible = users.filter(
    (u) => u.status === "active" && (ROLE_DEFAULTS[u.role]?.orders ?? 0) >= 1
  );
  const opts = eligible.map((u) => ({ value: u.id, label: label(u) }));
  if (currentId && !eligible.some((u) => u.id === currentId)) {
    const cur = users.find((u) => u.id === currentId);
    if (cur) opts.push({ value: cur.id, label: `${label(cur)} (deactivated)` });
  }
  return opts.sort((a, b) => a.label.localeCompare(b.label));
}

export function dispatcherName(users: Profile[], id: string | null): string | null {
  if (!id) return null;
  const u = users.find((x) => x.id === id);
  return u ? u.full_name?.trim() || u.email : null;
}
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: LocationModal** — add state, field, payload, audit:

```tsx
// imports
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { dispatcherOptions } from "../_lib/dispatcherOptions";

// inside component
const users = useAppSelector((s) => s.users.items);
const [dispatcherId, setDispatcherId] = useState<string>(location?.dispatcher_id ?? "");

// in handleSubmit, replace `const values = { name: name.trim(), type };` with:
const values = {
  name: name.trim(),
  type,
  // Dropship suppliers never hold stock, so never dispatch.
  dispatcher_id: type === "dropship" ? null : dispatcherId || null,
};

// audit metadata for create becomes:
// { name: data.name, type: data.type, dispatcher_id: data.dispatcher_id }
```

JSX, after the Type field and before the help `<p>`:

```tsx
{type !== "dropship" && (
  <Field label="Dispatcher">
    <Select value={dispatcherId} onChange={(e) => setDispatcherId(e.target.value)}>
      <option value="">None</option>
      {dispatcherOptions(users, location?.dispatcher_id ?? null).map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  </Field>
)}
{type !== "dropship" && (
  <p className="text-xs text-(--color-text-muted)">
    The dispatcher is emailed and sees a dashboard banner when an order linked to inventory is fulfilled from this location.
  </p>
)}
```

- [ ] **Step 6: LocationsTab** — add `const users = useAppSelector((s) => s.users.items);` next to the other selectors, import `dispatcherName`, and insert a column after "Type":

```tsx
{
  header: "Dispatcher",
  sortValue: (l: StockLocation) => dispatcherName(users, l.dispatcher_id) ?? "",
  render: (l: StockLocation) => (
    <span className="text-sm text-(--color-text-base)">{dispatcherName(users, l.dispatcher_id) ?? "—"}</span>
  ),
},
```

- [ ] **Step 7: Docs** — `inventory/CLAUDE.md`: add `_lib/dispatcherOptions.ts` to the file map, note LocationModal's Dispatcher field and LocationsTab's column. `inventory/SKILL.md`: minimal-file-set entry "Change who can be a dispatcher → `_lib/dispatcherOptions.ts` (+ test)"; gotcha "dispatcher eligibility uses role defaults only (exceptions are server-side); dropship locations always save `dispatcher_id: null`."

- [ ] **Step 8: Run** `npx jest dashboard/inventory` → PASS. **Commit**

```bash
git add src/app/dashboard/inventory
git commit -m "feat(inventory): assign a dispatcher to each stock location

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Orders location filter

**Files:**
- Modify: `src/lib/utils/filters.ts` (`SalesFilters` ~144, `DEFAULT_SALES_FILTERS` ~174, `filterSales` ~308, `isDefaultFilters` ~349)
- Modify: `src/app/dashboard/sales/_store/salesFilterParams.ts`, `salesFilterParams.test.ts`
- Modify: `src/app/dashboard/sales/_store/salesSlice.ts` (~line 59)
- Modify: `src/app/dashboard/sales/page.tsx` (filter bar ~line 440, export ~line 190, imports)
- Create: `src/app/dashboard/sales/_components/LocationParamSync.tsx`
- Modify: `src/app/dashboard/sales/CLAUDE.md`, `src/app/dashboard/sales/SKILL.md`
- Test: `src/app/dashboard/sales/_store/salesFilterParams.test.ts`, `src/lib/utils/filters.test.ts`

**Interfaces:**
- Consumes: `get_sales_summary(..., p_location_id)` (Task 1); `useAdvancedInventory()`.
- Produces: `SalesFilters.location: string` (`"all"` default); `SalesSummaryParams.p_location_id: string | null`; `salesSummaryRpcArgs` omits `p_location_id` when null; `<LocationParamSync onLocation={(id: string) => void} />`.

- [ ] **Step 1: Write failing tests** — in `salesFilterParams.test.ts` add `p_location_id: null` to both `toEqual` expectations in the first two tests, add `location: "all"` to the explicit filter object in the second test, and append:

```ts
  it("maps the location filter to p_location_id", () => {
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, location: "all" }).p_location_id).toBeNull();
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, location: "loc-1" }).p_location_id).toBe("loc-1");
  });
```

and in the `salesSummaryRpcArgs` describe:

```ts
  it("leaves p_location_id out when no location is set (pre-057 8-arg function)", () => {
    expect(salesSummaryRpcArgs(DEFAULT_SALES_FILTERS)).not.toHaveProperty("p_location_id");
  });

  it("sends p_location_id when a location is picked", () => {
    expect(salesSummaryRpcArgs({ ...DEFAULT_SALES_FILTERS, location: "loc-1" }).p_location_id).toBe("loc-1");
  });
```

In `src/lib/utils/filters.test.ts` add:

```ts
it("treats a set location as a non-default sales filter", () => {
  expect(isDefaultFilters({ ...DEFAULT_SALES_FILTERS, location: "loc-1" })).toBe(false);
  expect(isDefaultFilters(DEFAULT_SALES_FILTERS)).toBe(true);
});
```

(import `isDefaultFilters`/`DEFAULT_SALES_FILTERS` if not already imported.)

- [ ] **Step 2: Run** `npx jest dashboard/sales/_store/salesFilterParams src/lib/utils/filters.test.ts` → FAIL.

- [ ] **Step 3: Implement filters.ts**

```ts
// SalesFilters, after account:
  /** Fulfillment location id or "all" (057; advanced inventory only). */
  location: string;

// DEFAULT_SALES_FILTERS:
  location: "all",

// filterSales, after the account line:
  if (f.location && f.location !== "all")
    result = result.filter((s) => s.fulfillment_location_id === f.location);

// isDefaultFilters, after the account line:
    ("location" in f ? f.location === "all" : true) &&
```

- [ ] **Step 4: Implement salesFilterParams.ts**

```ts
// SalesSummaryParams:
  /** Arg name matches get_sales_summary in 057. */
  p_location_id: string | null;

// salesFilterParams return:
    p_location_id: f.location === "all" ? null : f.location,

// salesSummaryRpcArgs:
export function salesSummaryRpcArgs(f: SalesFilters): Omit<SalesSummaryParams, "p_connection_id" | "p_location_id"> & {
  p_connection_id?: string;
  p_location_id?: string;
} {
  const { p_connection_id, p_location_id, ...rest } = salesFilterParams(f);
  return {
    ...rest,
    ...(p_connection_id ? { p_connection_id } : {}),
    ...(p_location_id ? { p_location_id } : {}),
  };
}
```

Update the doc comment above `salesSummaryRpcArgs` to mention `p_location_id` (057) follows the same send-only-when-set rule.

- [ ] **Step 5: Run** the tests → PASS.

- [ ] **Step 6: salesSlice + export** — after the `connection_id` lines in `fetchSalesPage` (salesSlice.ts ~line 60) and in `handleExport` (page.tsx ~line 190) add:

```ts
    if (p.p_location_id) query = query.eq("fulfillment_location_id", p.p_location_id);
```

- [ ] **Step 7: Create `_components/LocationParamSync.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Applies `?location=<id>` (linked from DispatchBanner) to the Orders filters.
 * Isolated so page.tsx can wrap it in <Suspense> — Next requires a boundary
 * around useSearchParams.
 */
export function LocationParamSync({ onLocation }: { onLocation: (id: string) => void }) {
  const location = useSearchParams().get("location");
  useEffect(() => {
    if (location) onLocation(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run per URL value, not per callback identity
  }, [location]);
  return null;
}
```

- [ ] **Step 8: page.tsx** — imports (`Suspense` from react, `useAdvancedInventory`, `LocationParamSync`); `const advanced = useAdvancedInventory();`; render inside the page root (top):

```tsx
<Suspense fallback={null}>
  <LocationParamSync onLocation={(id) => setFilter("location", id)} />
</Suspense>
```

and after the Account filter block:

```tsx
{advanced.active && advanced.locations.length > 0 && (
  <div>
    <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Location</span>
    <select value={filters.location} onChange={(e) => setFilter("location", e.target.value)} className={filterInputCls}>
      <option value="all">All Locations</option>
      {advanced.locations.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  </div>
)}
```

`setFilter` closes over `filters`; `LocationParamSync` fires once per URL value after mount, when `filters` is the current state, so the closure is fresh enough. If `setFilter` is declared below the JSX use site that's fine (function hoisting within the component body only matters for declarations — it's a `function` declaration).

- [ ] **Step 9: Docs** — `sales/CLAUDE.md`: filter list gains **location** (advanced inventory only; `p_location_id` → `.eq("fulfillment_location_id")`, 057 summary arg sent only when set), file map gains `_components/LocationParamSync.tsx`. `sales/SKILL.md` gotcha: "`?location=` is applied by `LocationParamSync` inside `<Suspense>`; `get_sales_summary`'s `p_location_id` must be omitted when unset or pre-057 tenants 404 (PGRST202)." Also `src/lib/utils/SKILL.md` if it documents `SalesFilters` fields.

- [ ] **Step 10: Run** `npx jest dashboard/sales src/lib/utils/filters.test.ts` → PASS. **Commit**

```bash
git add src/lib/utils/filters.ts src/lib/utils/filters.test.ts src/lib/utils/SKILL.md src/app/dashboard/sales
git commit -m "feat(sales): filter orders by fulfillment location

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dispatch banner + flush nudge

**Files:**
- Create: `src/components/layout/dispatchBanner.ts`, `src/components/layout/dispatchBanner.test.ts`
- Create: `src/components/layout/DispatchBanner.tsx`
- Modify: `src/components/layout/DashboardShell.tsx` (~line 173, `<main>`)
- Modify: `src/app/dashboard/CLAUDE.md` (shell components section), `src/components/layout/SKILL.md` if present (else `src/app/dashboard/SKILL.md`)

**Interfaces:**
- Consumes: `my_dispatch_queue()` (Task 1); `requestDispatchFlush()` (Task 4); `usePlan()` + `hasAdvancedInventory()`; `state.sales.summaryVersion`; `createTenantClient()`.
- Produces: `interface DispatchQueueRow { location_id: string; location_name: string; open_count: number }`; `dispatchBannerLines(rows: DispatchQueueRow[]): { key: string; count: string; location: string; href: string }[]`; `<DispatchBanner />`.

- [ ] **Step 1: Write the failing test** `dispatchBanner.test.ts`:

```ts
import { dispatchBannerLines } from "./dispatchBanner";

describe("dispatchBannerLines", () => {
  it("pluralises and links each location", () => {
    expect(
      dispatchBannerLines([
        { location_id: "l1", location_name: "Berlin", open_count: 1 },
        { location_id: "l 2", location_name: "Hamburg", open_count: 3 },
      ])
    ).toEqual([
      { key: "l1", count: "1 order", location: "Berlin", href: "/dashboard/sales?location=l1" },
      { key: "l 2", count: "3 orders", location: "Hamburg", href: "/dashboard/sales?location=l%202" },
    ]);
  });

  it("drops zero-count rows", () => {
    expect(dispatchBannerLines([{ location_id: "l1", location_name: "Berlin", open_count: 0 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx jest src/components/layout/dispatchBanner` → FAIL.

- [ ] **Step 3: Implement `dispatchBanner.ts`**

```ts
/** One row of my_dispatch_queue() (057). */
export interface DispatchQueueRow {
  location_id: string;
  location_name: string;
  open_count: number;
}

export function dispatchBannerLines(rows: DispatchQueueRow[]) {
  return rows
    .filter((r) => r.open_count > 0)
    .map((r) => ({
      key: r.location_id,
      count: `${r.open_count} order${r.open_count === 1 ? "" : "s"}`,
      location: r.location_name,
      href: `/dashboard/sales?location=${encodeURIComponent(r.location_id)}`,
    }));
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Implement `DispatchBanner.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { usePlan } from "@/store/usePlan";
import { hasAdvancedInventory } from "@/lib/plans/entitlements";
import { createTenantClient } from "@/lib/supabase/client";
import { requestDispatchFlush } from "@/lib/utils/dispatchFlush";
import { dispatchBannerLines, type DispatchQueueRow } from "./dispatchBanner";

const DEBOUNCE_MS = 2000;

/**
 * Persistent "orders to dispatch" banner for a location's dispatcher (057).
 * Also the single place that nudges the dispatch email flush: on mount and,
 * debounced, whenever the sales slice records a write (summaryVersion is
 * bumped by addSale/updateSale/removeSale — every client write path).
 * Renders nothing for plans without advanced inventory or an empty queue.
 */
export function DispatchBanner() {
  const { ent } = usePlan();
  const entitled = !!ent && hasAdvancedInventory(ent);
  const summaryVersion = useAppSelector((s) => s.sales.summaryVersion);
  const pathname = usePathname();
  const [rows, setRows] = useState<DispatchQueueRow[]>([]);

  useEffect(() => {
    if (!entitled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      requestDispatchFlush();
      try {
        const supabase = await createTenantClient();
        const { data, error } = await supabase.rpc("my_dispatch_queue");
        if (!cancelled) setRows(error ? [] : ((data ?? []) as DispatchQueueRow[]));
      } catch {
        if (!cancelled) setRows([]);
      }
    }, summaryVersion === 0 ? 0 : DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [entitled, summaryVersion, pathname]);

  const lines = dispatchBannerLines(rows);
  if (!entitled || lines.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-6 rounded-[var(--radius-card)] border border-[var(--color-warning)] bg-[var(--color-warning-bg)] p-4 text-sm text-[var(--color-warning-text)]"
    >
      <div className="flex items-start gap-3">
        <PackageCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l.key}>
              You have{" "}
              <Link href={l.href} className="font-semibold underline hover:no-underline">{l.count}</Link>{" "}
              to dispatch from <strong>{l.location}</strong>.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Mount in `DashboardShell.tsx`** — import `DispatchBanner` and change the main element to:

```tsx
<main className="flex-1 overflow-y-auto p-6 md:p-8">
  <DispatchBanner />
  {children}
</main>
```

- [ ] **Step 7: Docs** — `src/app/dashboard/CLAUDE.md` "Shared shell components": add `DispatchBanner` (057): dispatcher-only banner from `my_dispatch_queue()`, plus the single `requestDispatchFlush()` nudge on mount/route change/`summaryVersion` (2 s debounce); entitlement-gated via `usePlan()`. Add a SKILL gotcha: "Don't add per-modal flush calls — `summaryVersion` already covers every client write path; new write paths that bypass `salesSlice` actions must bump it or call `requestDispatchFlush()`."

- [ ] **Step 8: Run** `npx jest src/components/layout` → PASS. **Commit**

```bash
git add src/components/layout src/app/dashboard/CLAUDE.md src/app/dashboard/SKILL.md
git commit -m "feat(layout): dispatch banner for location dispatchers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verification, verifier and PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-location-dispatch-notifications-design.md` (status line only)

- [ ] **Step 1: Run focused tests for everything touched**

```bash
npx jest src/lib/email src/lib/dispatch src/lib/utils/notifications.test.ts src/lib/utils/filters.test.ts dashboard/inventory dashboard/sales src/components/layout
```

Expected: all PASS.

- [ ] **Step 2: Project verifier on the diff**

```bash
uv run .claude/verifiers/verify_changes.py
```

Expected: no new findings. In particular `route-without-auth-guard` must not fire for `api/dispatch/flush` (it calls `requireSectionAccess`), and no `console.log`.

- [ ] **Step 3: Mark spec status** `**Status:** Implemented (PR pending), migration 057 not applied` and commit with docs.

- [ ] **Step 4: Push and open PR** (pre-push runs jest + next build)

```bash
git push -u origin feat/location-dispatch-notifications
gh pr create --title "Location dispatchers + dispatch email/bell/banner (057)" --body "$(cat <<'EOF'
## Summary
- One dispatcher per stock location (Business plan, advanced inventory).
- When an order first has a linked product + fulfillment location, the dispatcher gets an email (Mailgun SMTP via nodemailer), a bell notification, and a persistent dashboard banner until the order leaves pending/processing.
- Orders page gains a Location filter (banner links to it).

## Database
New `057_location_dispatchers.sql` (installer `install_location_dispatchers`), edits to 055 (`notifications_select` recipient disjunct, `notification_section`) and 005 (calls the installer).
**Apply order:** 056 → re-apply 055 → 057 → re-apply 005. Then run `supabase/verify/057_location_dispatchers_check.sql` (rolls back).

## Env
Add to Vercel: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (same Mailgun creds as Supabase SMTP).

## Manual check
1. Inventory → Locations → edit a location → pick a Dispatcher.
2. Add an order with an inventory product fulfilled from that location (status pending).
3. Dispatcher: email arrives, bell shows "Dispatch", banner shows the count and links to Orders filtered by location.
4. Mark the order shipped → banner count drops.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Update memory** `location-dispatch-notifications-project.md` with the PR number and "057 not applied".
