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
-- notifications_select) → this file → re-apply 005. 056 is a HARD
-- prerequisite: step 5's get_sales_summary references s.connection_id
-- (added by 056), so applying this before 056 fails.
--
-- Trigger design: sales_dispatch_flag (BEFORE) sets NEW.dispatch_notified_at;
-- sales_dispatch_notify (AFTER) writes the notification + outbox rows. The
-- flag is NEVER written by a second UPDATE from the AFTER trigger — that
-- would re-fire 047's inv_sale_* ledger triggers. sales_dispatch_flag sorts
-- after inv_sale_before_write (triggers fire alphabetically), so it sees the
-- fulfillment_location_id that trigger defaults from platform/tenant defaults.
--
-- Notify rule: only on INSERT, when the product is first linked, or when the
-- fulfillment location changes (and product+location set, open status,
-- advanced inventory on, dispatcher active). Unrelated saves never notify.
-- CSV imports never notify: the Sales importer inserts with
-- sales.dispatch_suppressed = true (only once 057 is applied — it sends the
-- key only when some location has a dispatcher), which leaves the flag NULL
-- on INSERT. Later edits follow the normal UPDATE rules (a location change
-- notifies; unrelated saves don't). The column is ignored on UPDATE.
--
-- Stale outbox rows: claim_dispatch_emails returns still_relevant (order
-- still open AND its CURRENT location's dispatcher is the recipient);
-- processOutbox skips the send when false.
--
-- RULE for editing: inside format($sql$ … $sql$, schema_name) strings never
-- write a literal percent sign — format() consumes it. Where the inner body
-- genuinely needs one (sales_dispatch_notify's RAISE WARNING placeholder),
-- it is written doubled so format() emits a single one.
--
-- Dispatcher eligibility = profiles.status 'active' AND effective Orders
-- access >= 1 (user_section_level, step 1b — mirrors 055 for any user).
-- Checked when the flag is set AND again at claim time
-- (recipient_can_view_orders), since access can be revoked in between.
--
-- my_dispatch_queue (banner) is SECURITY DEFINER with explicit checks
-- (dispatcher = auth.uid(), tenant member, Orders >= 1, advanced on), so a
-- dispatcher sees their banner even without Inventory access (stock_locations
-- RLS needs Inventory >= 1).
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
    -- Set by the CSV importer: an INSERT with this true never notifies.
    ALTER TABLE %1$I.sales
      ADD COLUMN IF NOT EXISTS dispatch_suppressed boolean NOT NULL DEFAULT false;
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

  -- ── 1b. Effective section level for an ARBITRARY user ─────
  -- Mirrors 055's current_user_access_base (exception row, else role
  -- default; super_admin = section max; deactivated = 0) for p_user instead
  -- of auth.uid(). Used by the dispatch trigger and claim_dispatch_emails to
  -- check the dispatcher can view Orders. Does NOT apply 055's
  -- listings/messages → integrations dependency rule (only 'orders' is
  -- asked here). plpgsql, not sql, so it can be created before 055's
  -- objects exist (provision_tenant_schema runs this installer before
  -- install_section_permissions; step 6 below installs them in the same
  -- call). If 055 is missing at call time it fails closed (0) rather than
  -- erroring inside the sales BEFORE trigger. Service role / definer only.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.user_section_level(p_user uuid, p_section text)
    RETURNS smallint LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = %1$I
    AS $f$
    BEGIN
      IF to_regclass('user_section_access') IS NULL
         OR to_regprocedure('role_section_default(text, text)') IS NULL THEN
        RETURN 0::smallint;
      END IF;
      RETURN COALESCE((
        SELECT CASE
          WHEN p.status = 'deactivated' THEN 0::smallint
          WHEN p.role = 'super_admin' THEN section_max_level(p_section)
          ELSE COALESCE(
            (SELECT a.level FROM user_section_access a WHERE a.user_id = p.id AND a.section = p_section),
            role_section_default(p.role, p_section))
        END
        FROM profiles p WHERE p.id = p_user
      ), 0::smallint);
    END;
    $f$;
  $sql$, schema_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.user_section_level(uuid, text) FROM PUBLIC, anon, authenticated', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.user_section_level(uuid, text) TO service_role', schema_name);

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
        -- Bulk (CSV) import: never notify at insert time. The column is
        -- ignored on UPDATE, so later edits follow the normal rules below.
        IF NEW.dispatch_suppressed THEN
          RETURN NEW;
        END IF;
      ELSE
        NEW.dispatch_notified_at := OLD.dispatch_notified_at;
        -- ANY location change (incl. to/from NULL) re-arms the flag: the new
        -- warehouse's dispatcher must be told.
        IF NEW.fulfillment_location_id IS DISTINCT FROM OLD.fulfillment_location_id THEN
          NEW.dispatch_notified_at := NULL;
        END IF;
      END IF;

      -- Rule: notify only on a qualifying transition — INSERT, product just
      -- linked (OLD.product_id IS NULL), or location changed. An unrelated
      -- save of an existing open order never notifies (no back-dated pings
      -- after a dispatcher is assigned). Status changes alone never notify.
      IF NEW.dispatch_notified_at IS NULL
         AND (TG_OP = 'INSERT'
              OR OLD.product_id IS NULL
              OR NEW.fulfillment_location_id IS DISTINCT FROM OLD.fulfillment_location_id)
         AND NEW.product_id IS NOT NULL
         AND NEW.fulfillment_location_id IS NOT NULL
         AND lower(coalesce(NEW.status, '')) IN ('pending', 'processing')
         AND coalesce((SELECT advanced_enabled FROM inventory_settings WHERE id), false) THEN
        -- Eligible dispatcher: active AND effective Orders access >= 1 (the
        -- email carries buyer name/address — never send it to someone the
        -- Orders RLS would hide that order from). user_section_level (step 1b)
        -- is resolved at call time.
        SELECT l.dispatcher_id INTO v_dispatcher
          FROM stock_locations l
          JOIN profiles p ON p.id = l.dispatcher_id
         WHERE l.id = NEW.fulfillment_location_id
           AND p.status = 'active'
           AND user_section_level(p.id, 'orders') >= 1;
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

      -- Notifications must never block a core business write (029's rule),
      -- but a swallowed failure should still leave a trace in the Postgres
      -- log. The RAISE WARNING format strings below are written as a
      -- doubled percent sign because this body sits inside the installer's
      -- format(...) call, which collapses it to the single placeholder
      -- plpgsql RAISE expects.
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
        RAISE WARNING 'sales_dispatch_notify (notification): %%', SQLERRM;
      END;

      BEGIN
        INSERT INTO dispatch_email_outbox (sale_id, recipient_user_id)
          VALUES (NEW.id, v_dispatcher);
      EXCEPTION WHEN others THEN
        RAISE WARNING 'sales_dispatch_notify (outbox): %%', SQLERRM;
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
  -- recipient_can_view_orders is re-checked at claim time (access may have
  -- been revoked since the row was queued); processOutbox skips the send.
  -- still_relevant (last column) = the order is still pending/processing AND
  -- its CURRENT fulfillment location's dispatcher is this row's recipient —
  -- false once the order was shipped/cancelled or moved. Keep the TS mirror
  -- ClaimedDispatchEmail (src/lib/dispatch/processOutbox.ts) in sync.
  -- DROP first: CREATE OR REPLACE cannot change a RETURNS TABLE column list.
  EXECUTE format('DROP FUNCTION IF EXISTS %I.claim_dispatch_emails(int)', schema_name);
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.claim_dispatch_emails(p_limit int)
    RETURNS TABLE (
      outbox_id uuid, sale_id uuid, recipient_email text, recipient_name text,
      recipient_active boolean, recipient_can_view_orders boolean, location_name text, product_name text, quantity int,
      platform text, marketplace text, external_order_id text, order_date date,
      buyer_name text, shipping_address_line1 text, shipping_address_line2 text,
      shipping_city text, shipping_state text, shipping_postal_code text, shipping_country text,
      still_relevant boolean
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
             (user_section_level(p.id, 'orders') >= 1),
             l.name, s.product_name, s.quantity, s.platform, s.marketplace,
             s.external_order_id, s.date, s.buyer_name,
             s.shipping_address_line1, s.shipping_address_line2, s.shipping_city,
             s.shipping_state, s.shipping_postal_code, s.shipping_country,
             (lower(coalesce(s.status, '')) IN ('pending', 'processing')
              AND coalesce(l.dispatcher_id = c.recipient_user_id, false))
        FROM claimed c
        JOIN sales s    ON s.id = c.sale_id
        JOIN profiles p ON p.id = c.recipient_user_id
        LEFT JOIN stock_locations l ON l.id = s.fulfillment_location_id
    $f$;
  $sql$, schema_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.claim_dispatch_emails(int) FROM PUBLIC, anon, authenticated', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.claim_dispatch_emails(int) TO service_role', schema_name);

  -- ── 4. Banner query (definer, explicit checks) ─────────────
  -- SECURITY DEFINER so a dispatcher without Inventory access (stock_locations
  -- RLS) still sees their queue. Bypassing RLS is safe only because every
  -- row is restricted explicitly: the caller is the dispatcher, a tenant
  -- member, with effective Orders >= 1 (user_section_level, step 1b), and
  -- advanced inventory is on. Returns counts + location names only.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.my_dispatch_queue()
    RETURNS TABLE (location_id uuid, location_name text, open_count int)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = %1$I
    AS $f$
      SELECT l.id, l.name, count(s.id)::int
        FROM stock_locations l
        JOIN sales s ON s.fulfillment_location_id = l.id
       WHERE l.dispatcher_id = auth.uid()
         AND is_tenant_member()
         AND user_section_level(auth.uid(), 'orders') >= 1
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
