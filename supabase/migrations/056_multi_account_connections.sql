-- ============================================================
-- 056 — multiple eBay/Amazon accounts per tenant (sub-project 1)
--
-- platform_connections: one row per ACCOUNT, not per platform.
--   UNIQUE (platform) → UNIQUE (platform, external_account_id). Legacy eBay
--   rows have external_account_id NULL (the adapter never stored one); NULLs
--   are distinct, so they don't conflict. They're adopted on reconnect.
--   display_name: admin-editable label. external_username: eBay username,
--   used by the account-deletion webhook to match legacy rows.
--   is_active = false means the admin paused the account; the plan cap is
--   applied on top in app code (src/lib/utils/activeAccounts.ts).
--
-- sales.connection_id: which account an order came from. NULL = Unassigned.
--   Backfilled for synced orders when the platform has exactly one row.
--
-- get_sales_summary gains trailing p_connection_id (DEFAULT NULL;
-- '__unassigned__' = connection_id IS NULL — keep in sync with
-- UNASSIGNED_ACCOUNT in src/lib/utils/platformAccounts.ts). Old 7-arg
-- signature dropped first, as in 052.
--
-- get_platform_accounts(): SECURITY DEFINER, token-free account list for any
-- tenant member (platform_connections RLS is admin-only).
--
-- Also baked into provision_tenant_schema() (005, same commit).
-- Spec: docs/superpowers/specs/2026-10-08-multi-account-integrations-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.platform_connections
    ADD COLUMN IF NOT EXISTS display_name text,
    ADD COLUMN IF NOT EXISTS external_username text,
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

  ALTER TABLE {{schema}}.platform_connections
    DROP CONSTRAINT IF EXISTS platform_connections_platform_key;

  DO $do$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = 'platform_connections_platform_account_key'
        AND n.nspname = '{{schema}}'
    ) THEN
      ALTER TABLE {{schema}}.platform_connections
        ADD CONSTRAINT platform_connections_platform_account_key
        UNIQUE (platform, external_account_id);
    END IF;
  END
  $do$;

  CREATE INDEX IF NOT EXISTS idx_platform_connections_platform_created
    ON {{schema}}.platform_connections (platform, created_at);

  UPDATE {{schema}}.platform_connections
     SET display_name = CASE platform
           WHEN 'ebay'   THEN coalesce(external_account_id, 'eBay account')
           WHEN 'amazon' THEN 'Amazon – ' || coalesce(right(external_account_id, 6), 'account')
         END
   WHERE display_name IS NULL;

  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS connection_id uuid
      REFERENCES {{schema}}.platform_connections(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_sales_connection_id ON {{schema}}.sales (connection_id);

  UPDATE {{schema}}.sales s
     SET connection_id = pc.id
    FROM {{schema}}.platform_connections pc
   WHERE s.connection_id IS NULL
     AND s.external_order_id IS NOT NULL
     AND s.platform = pc.platform
     AND (SELECT count(*) FROM {{schema}}.platform_connections x WHERE x.platform = pc.platform) = 1;

  DROP FUNCTION IF EXISTS {{schema}}.get_sales_summary(date, date, text, text, text, text, text);

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_summary(
    p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text,
    p_marketplace text DEFAULT NULL,
    p_connection_id text DEFAULT NULL
  )
  RETURNS TABLE (
    currency text, order_count int, gross numeric, vat numeric,
    fees numeric, shipping_charged numeric, excluded_count int, vat_base numeric
  )
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
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

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_summary(date, date, text, text, text, text, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_platform_accounts()
  RETURNS TABLE (
    id uuid, platform text, display_name text, status text,
    is_active boolean, created_at timestamptz
  )
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = {{schema}}
  AS $func$
    SELECT pc.id, pc.platform, pc.display_name, pc.status, pc.is_active, pc.created_at
    FROM platform_connections pc
    WHERE {{schema}}.is_tenant_member()
    ORDER BY pc.platform, pc.created_at;
  $func$;

  REVOKE ALL ON FUNCTION {{schema}}.get_platform_accounts() FROM public;
  GRANT EXECUTE ON FUNCTION {{schema}}.get_platform_accounts() TO authenticated;
$$);
