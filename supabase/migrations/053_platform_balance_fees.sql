-- ============================================================
-- 053 — per-platform balance: platform fees + buyer-paid shipping
--
-- Redefines get_sales_overview (045) so its `by_platform` bucket — which
-- feeds `revenueByPlatform` (Home's per-platform cards, the Analytics
-- donut) and `platformBalance` (the eBay/Amazon balance card + chart) —
--   1. sums the per-order `platform_fee` as `platformFees`. 045 predates
--      035's platform_fee column and never read it, so a recorded platform
--      fee lowered Net Profit (whose `fees` did include it) but not the
--      platform's "Balance earned" — found 2026-09-29 on tenant_kaufnest,
--      Sept 2026: balance showed 235.37 instead of 233.12 (one order with
--      a 2.25 platform fee).
--   2. counts buyer-paid shipping (`shipping_charged`) in `sales`, i.e. the
--      same revenue formula as the headline `revenue`. This deliberately
--      retires 045's "Formula B" (items-only) for revenueByPlatform and
--      platformBalance: buyer-paid shipping lands in the platform account,
--      and per-platform revenue should add up to the Revenue tile.
--      topProducts stays items-only (a product's revenue excludes shipping).
--
-- Same signature and return shape as 045 plus one new key, so CREATE OR
-- REPLACE is enough and the client reads `platformFees ?? 0` until this is
-- applied. Not SECURITY DEFINER. Also baked into provision_tenant_schema()
-- (005, same commit).
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM sales
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    effective AS (
      SELECT *
      FROM filtered
      WHERE status NOT IN ('returned', 'cancelled')
    ),
    by_platform AS (
      SELECT
        platform,
        sum(total_amount + coalesce(shipping_charged, 0)) AS sales,
        sum(coalesce(advertising_fee, 0)) AS ad_fees,
        sum(coalesce(shipping_cost, 0)) AS shipping_fees,
        sum(coalesce(platform_fee, 0)) AS platform_fees,
        count(*) AS cnt
      FROM effective
      GROUP BY platform
    ),
    top_products AS (
      SELECT product_name AS name, sum(total_amount) AS revenue, sum(quantity) AS units
      FROM effective
      GROUP BY product_name
      ORDER BY sum(total_amount) DESC
      LIMIT 5
    ),
    monthly AS (
      SELECT to_char(date, 'YYYY-MM') AS month,
             sum(total_amount + coalesce(shipping_charged, 0)) AS revenue
      FROM effective
      GROUP BY 1
    )
    SELECT jsonb_build_object(
      'orderCount', (SELECT count(*) FROM filtered),
      'effectiveOrderCount', (SELECT count(*) FROM effective),
      'unitsSold', (SELECT coalesce(sum(quantity), 0) FROM effective),
      'revenue', (SELECT coalesce(sum(total_amount + coalesce(shipping_charged, 0)), 0) FROM effective),
      'fees', (SELECT coalesce(sum(coalesce(shipping_cost, 0) + coalesce(advertising_fee, 0) + coalesce(platform_fee, 0)), 0) FROM effective),
      'vatCollected', (SELECT coalesce(sum(vat_amount), 0) FROM effective),
      'revenueByPlatform', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'value', sales) ORDER BY sales DESC), '[]'::jsonb)
        FROM by_platform
      ),
      'topProducts', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue, 'units', units)), '[]'::jsonb)
        FROM top_products
      ),
      'monthlyRevenue', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('month', month, 'revenue', revenue) ORDER BY month), '[]'::jsonb)
        FROM monthly
      ),
      'platformBalance', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'platform', platform, 'sales', sales, 'adFees', ad_fees, 'shippingFees', shipping_fees,
          'platformFees', platform_fees, 'count', cnt
        )), '[]'::jsonb)
        FROM by_platform
        WHERE platform IN ('ebay', 'amazon')
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_overview(date, date, text) TO authenticated;
$$);
