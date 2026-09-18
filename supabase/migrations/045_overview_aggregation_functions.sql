-- ============================================================
-- Overview aggregation functions — every tenant schema (run_on_all_tenant_schemas)
--
-- Replaces the Overview page's client-side fetchAllRows aggregation (up to
-- 5000 rows per table downloaded to compute a dozen numbers) with four
-- server-side functions, one per table, each returning a small jsonb
-- result. See docs/superpowers/specs/2026-09-16-overview-rpc-aggregation-design.md
-- for the full design and the "Business logic inventory" section this SQL
-- reproduces exactly (including two genuinely distinct revenue formulas —
-- do not unify them if you touch this file later).
--
-- Not SECURITY DEFINER: these run as the calling user, so the existing
-- sales_select/expenses_select/purchases_select/platform_payouts_select RLS
-- policies still gate what a tenant member can see, same as the client-side
-- .select() queries they replace.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets these from the start.
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
        sum(total_amount) AS sales,
        sum(coalesce(advertising_fee, 0)) AS ad_fees,
        sum(coalesce(shipping_cost, 0)) AS shipping_fees,
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
          'platform', platform, 'sales', sales, 'adFees', ad_fees, 'shippingFees', shipping_fees, 'count', cnt
        )), '[]'::jsonb)
        FROM by_platform
        WHERE platform IN ('ebay', 'amazon')
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_overview(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_expenses_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM expenses
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    by_category AS (
      SELECT category, sum(amount) AS amount
      FROM filtered
      GROUP BY category
    ),
    monthly AS (
      SELECT to_char(date, 'YYYY-MM') AS month, sum(amount) AS amount
      FROM filtered
      GROUP BY 1
    ),
    platform_sub AS (
      SELECT 'ebay' AS platform, coalesce(sum(amount), 0) AS amount
      FROM filtered
      WHERE vendor ILIKE '%ebay%' OR title ILIKE '%ebay%'
      UNION ALL
      SELECT 'amazon' AS platform, coalesce(sum(amount), 0) AS amount
      FROM filtered
      WHERE vendor ILIKE '%amazon%' OR title ILIKE '%amazon%'
    )
    SELECT jsonb_build_object(
      'total', (SELECT coalesce(sum(amount), 0) FROM filtered),
      'vatPaid', (SELECT coalesce(sum(vat_amount), 0) FROM filtered),
      'byCategory', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) ORDER BY amount DESC), '[]'::jsonb)
        FROM by_category
      ),
      'monthlyExpenses', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount) ORDER BY month), '[]'::jsonb)
        FROM monthly
      ),
      'platformSubtotal', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'amount', amount)), '[]'::jsonb)
        FROM platform_sub
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_expenses_overview(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_purchases_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM purchases
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    monthly AS (
      SELECT to_char(date, 'YYYY-MM') AS month, sum(total_amount) AS amount
      FROM filtered
      GROUP BY 1
    )
    SELECT jsonb_build_object(
      'total', (SELECT coalesce(sum(total_amount), 0) FROM filtered),
      'vatPaid', (SELECT coalesce(sum(vat_amount), 0) FROM filtered),
      'monthlyPurchases', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount) ORDER BY month), '[]'::jsonb)
        FROM monthly
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_purchases_overview(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_payouts_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM platform_payouts
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    by_platform AS (
      SELECT platform, sum(amount) AS amount
      FROM filtered
      GROUP BY platform
    )
    SELECT jsonb_build_object(
      'transferred', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'amount', amount)), '[]'::jsonb)
        FROM by_platform
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_payouts_overview(date, date, text) TO authenticated;
$$);
