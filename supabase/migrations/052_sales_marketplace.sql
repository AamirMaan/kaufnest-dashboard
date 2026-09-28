-- ============================================================
-- 052 — sales.marketplace + VAT base
--
-- `marketplace`: regional storefront (amazon.de, ebay.co.uk …), normalised
-- client-side by normalizeMarketplace (src/lib/utils/marketplace.ts). NULL =
-- unknown (manual entries, pre-052 imports not yet re-imported).
--
-- VAT base (net taxable amount declared to the tax office) is DERIVED, not
-- stored: total_amount + shipping_charged − vat_amount over rows with VAT.
-- For Amazon, total_amount is the ITEM total, shipping lives in
-- shipping_charged, and vat_amount is the COMBINED item + shipping VAT —
-- dropping shipping_charged would understate the base.
--
-- get_sales_summary gains p_marketplace (DEFAULT NULL, so a client still
-- sending the 6 old named args keeps working mid-deploy) and a trailing
-- vat_base column. Its parameter list changes, so the old signature is
-- DROPPED first — CREATE OR REPLACE cannot change it, and leaving it would
-- create an ambiguous overload.
--
-- '__unknown__' is the client's UNKNOWN_MARKETPLACE sentinel — keep in sync.
-- Not SECURITY DEFINER (RLS on sales applies). Also baked into
-- provision_tenant_schema() (005, same commit).
-- See docs/superpowers/specs/2026-09-28-sales-marketplace-vat-base-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales ADD COLUMN IF NOT EXISTS marketplace text;
  CREATE INDEX IF NOT EXISTS idx_sales_marketplace ON {{schema}}.sales (marketplace);

  DROP FUNCTION IF EXISTS {{schema}}.get_sales_summary(date, date, text, text, text, text);

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_summary(
    p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text,
    p_marketplace text DEFAULT NULL
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

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_summary(date, date, text, text, text, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_by_marketplace(p_from date, p_to date, p_currency text)
  RETURNS TABLE (marketplace text, order_count int, revenue numeric, vat numeric, vat_base numeric)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT
      s.marketplace,
      count(*)::int,
      coalesce(sum(s.total_amount + coalesce(s.shipping_charged, 0)), 0),
      coalesce(sum(coalesce(s.vat_amount, 0)), 0),
      coalesce(sum(s.total_amount + coalesce(s.shipping_charged, 0) - s.vat_amount)
               FILTER (WHERE coalesce(s.vat_amount, 0) > 0), 0)
    FROM sales s
    WHERE s.currency = p_currency
      AND s.status NOT IN ('returned', 'cancelled')
      AND (p_from IS NULL OR s.date >= p_from)
      AND (p_to IS NULL OR s.date <= p_to)
    GROUP BY s.marketplace
    ORDER BY 3 DESC, 1;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_by_marketplace(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_marketplaces()
  RETURNS TABLE (marketplace text)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT DISTINCT s.marketplace FROM sales s WHERE s.marketplace IS NOT NULL ORDER BY 1;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_marketplaces() TO authenticated;
$$);
