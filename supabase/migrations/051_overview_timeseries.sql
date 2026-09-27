-- ============================================================
-- Overview timeseries — every tenant schema (run_on_all_tenant_schemas)
--
-- Backs the Overview page's chart cards: one call returns zero-filled
-- monthly buckets (revenue by platform, orders, returned/cancelled, sale
-- fees, expenses by category, purchases, units, VAT collected/paid), the
-- equal-length previous period's totals (for the change badges) and the
-- top purchase vendor.
--
-- Same revenue/fee formulas and returned/cancelled exclusion as
-- 045_overview_aggregation_functions.sql, so headline totals and charts
-- agree. `orders` counts every order (like 045's orderCount).
-- Month span: [month(p_from), month(p_to)]; an open side falls back to the
-- earliest/latest dated row in the three tables. `previous` is null when
-- either bound is null ("all time").
--
-- No literal percent signs in the body on purpose: the copy in
-- 005_tenant_provisioning.sql runs through format().
-- Not SECURITY DEFINER: runs as the caller, so the *_select RLS policies
-- gate visibility. Also baked into provision_tenant_schema() (005, same
-- commit).
-- See docs/superpowers/specs/2026-09-26-summary-tiles-receipt-autofill-overview-charts-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE OR REPLACE FUNCTION {{schema}}.get_overview_timeseries(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH s AS (
      SELECT *, status NOT IN ('returned', 'cancelled') AS effective
      FROM sales
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    e AS (
      SELECT * FROM expenses
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    p AS (
      SELECT * FROM purchases
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    bounds AS (
      SELECT
        date_trunc('month', coalesce(p_from, least(
          (SELECT min(date) FROM s), (SELECT min(date) FROM e), (SELECT min(date) FROM p), p_to
        )))::date AS lo,
        date_trunc('month', coalesce(p_to, greatest(
          (SELECT max(date) FROM s), (SELECT max(date) FROM e), (SELECT max(date) FROM p), p_from
        )))::date AS hi
    ),
    months AS (
      SELECT to_char(m, 'YYYY-MM') AS month
      FROM bounds, generate_series(bounds.lo, bounds.hi, interval '1 month') AS m
    ),
    sales_platform AS (
      SELECT to_char(date, 'YYYY-MM') AS month, platform,
             sum(total_amount + coalesce(shipping_charged, 0)) AS amount
      FROM s WHERE effective
      GROUP BY 1, 2
    ),
    sales_month AS (
      SELECT to_char(date, 'YYYY-MM') AS month,
             count(*) AS orders,
             count(*) FILTER (WHERE NOT effective) AS returned_cancelled,
             coalesce(sum(coalesce(shipping_cost, 0) + coalesce(advertising_fee, 0) + coalesce(platform_fee, 0))
                      FILTER (WHERE effective), 0) AS fees,
             coalesce(sum(coalesce(vat_amount, 0)) FILTER (WHERE effective), 0) AS vat
      FROM s
      GROUP BY 1
    ),
    expense_category AS (
      SELECT to_char(date, 'YYYY-MM') AS month, category, sum(amount) AS amount
      FROM e
      GROUP BY 1, 2
    ),
    expense_month AS (
      SELECT to_char(date, 'YYYY-MM') AS month, sum(amount) AS amount,
             sum(coalesce(vat_amount, 0)) AS vat
      FROM e
      GROUP BY 1
    ),
    purchase_month AS (
      SELECT to_char(date, 'YYYY-MM') AS month, sum(total_amount) AS amount,
             sum(quantity) AS units, sum(coalesce(vat_amount, 0)) AS vat
      FROM p
      GROUP BY 1
    ),
    prev AS (
      SELECT p_from - (p_to - p_from + 1) AS pf, p_from - 1 AS pt
      WHERE p_from IS NOT NULL AND p_to IS NOT NULL
    )
    SELECT jsonb_build_object(
      'months', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'month', m.month,
          'revenue_by_platform', coalesce((
            SELECT jsonb_object_agg(sp.platform, sp.amount) FROM sales_platform sp WHERE sp.month = m.month
          ), '{}'::jsonb),
          'orders', coalesce(sm.orders, 0),
          'returned_cancelled', coalesce(sm.returned_cancelled, 0),
          'fees', coalesce(sm.fees, 0),
          'expenses_by_category', coalesce((
            SELECT jsonb_object_agg(ec.category, ec.amount) FROM expense_category ec WHERE ec.month = m.month
          ), '{}'::jsonb),
          'expenses', coalesce(em.amount, 0),
          'purchases', coalesce(pm.amount, 0),
          'units', coalesce(pm.units, 0),
          'vat_collected', coalesce(sm.vat, 0),
          'vat_paid', coalesce(em.vat, 0) + coalesce(pm.vat, 0)
        ) ORDER BY m.month), '[]'::jsonb)
        FROM months m
        LEFT JOIN sales_month sm ON sm.month = m.month
        LEFT JOIN expense_month em ON em.month = m.month
        LEFT JOIN purchase_month pm ON pm.month = m.month
      ),
      'previous', (
        SELECT jsonb_build_object(
          'revenue', (SELECT coalesce(sum(total_amount + coalesce(shipping_charged, 0)), 0) FROM sales
                      WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt
                        AND status NOT IN ('returned', 'cancelled')),
          'fees', (SELECT coalesce(sum(coalesce(shipping_cost, 0) + coalesce(advertising_fee, 0) + coalesce(platform_fee, 0)), 0) FROM sales
                   WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt
                     AND status NOT IN ('returned', 'cancelled')),
          'orders', (SELECT count(*) FROM sales
                     WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt),
          'expenses', (SELECT coalesce(sum(amount), 0) FROM expenses
                       WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt),
          'purchases', (SELECT coalesce(sum(total_amount), 0) FROM purchases
                        WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt)
        )
        FROM prev
      ),
      'top_vendor', (
        SELECT jsonb_build_object('name', v.vendor, 'amount', v.amount)
        FROM (
          SELECT vendor, sum(total_amount) AS amount
          FROM p
          WHERE nullif(btrim(vendor), '') IS NOT NULL
          GROUP BY vendor
          ORDER BY sum(total_amount) DESC, vendor
          LIMIT 1
        ) v
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_overview_timeseries(date, date, text) TO authenticated;
$$);
