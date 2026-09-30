-- ============================================================
-- 054 — Home tile fixes: calendar previous period, effective orders,
--       running platform balance
--
-- 1. get_overview_timeseries (051, CREATE OR REPLACE, same signature):
--    `previous` for a range of whole calendar months (every Overview
--    preset) is now the same number of preceding calendar months instead of
--    an equal-length day window — "This month" (Sep 1–30) compared against
--    Aug 2–31 and silently dropped Aug 1. Custom partial ranges keep the
--    equal-length window. `previous` gains `effective_orders` (returned/
--    cancelled excluded) so the Home Orders tile — now effective orders,
--    like Revenue and the platform cards — can compute its delta.
-- 2. NEW get_platform_running_balance(p_to, p_currency): eBay/Amazon
--    earned / platform-tagged expenses / transferred from the first record
--    through p_to (all time when NULL). "Still in <platform> account" is a
--    running balance; scoping it to the picked period ignored earlier
--    payouts (tenant_kaufnest: Jul 194.63 + Aug 691.20 were invisible under
--    "This month") and earlier unpaid earnings. The expense match uses
--    strpos(lower(...)) — equivalent to 045's ILIKE '<pct>ebay<pct>' — so the
--    005 format() copy carries no literal percent sign.
--
-- Not SECURITY DEFINER (RLS applies). Also baked into
-- provision_tenant_schema() (005, same commit).
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
    -- 054: a range of whole calendar months (every preset: month, quarter,
    -- year, "Specific period") compares against the same number of
    -- preceding calendar months; any other range keeps the equal-length
    -- window. Sept 1–30 → Aug 1–31 (was Aug 2–31).
    prev AS (
      SELECT CASE
               WHEN p_from = date_trunc('month', p_from)::date
                AND p_to = (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date
               THEN (p_from - make_interval(months => ((extract(year FROM p_to) - extract(year FROM p_from)) * 12
                                                      + extract(month FROM p_to) - extract(month FROM p_from) + 1)::int))::date
               ELSE p_from - (p_to - p_from + 1)
             END AS pf,
             p_from - 1 AS pt
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
          'effective_orders', (SELECT count(*) FROM sales
                               WHERE currency = p_currency AND date BETWEEN prev.pf AND prev.pt
                                 AND status NOT IN ('returned', 'cancelled')),
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

  CREATE OR REPLACE FUNCTION {{schema}}.get_platform_running_balance(p_to date, p_currency text)
  RETURNS TABLE (platform text, earned numeric, expenses numeric, transferred numeric)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT
      pl.platform,
      coalesce((SELECT sum(s.total_amount + coalesce(s.shipping_charged, 0) - coalesce(s.advertising_fee, 0)
                           - coalesce(s.shipping_cost, 0) - coalesce(s.platform_fee, 0))
                FROM sales s
                WHERE s.platform = pl.platform AND s.currency = p_currency
                  AND s.status NOT IN ('returned', 'cancelled')
                  AND (p_to IS NULL OR s.date <= p_to)), 0),
      coalesce((SELECT sum(e.amount)
                FROM expenses e
                WHERE e.currency = p_currency
                  AND (strpos(lower(coalesce(e.vendor, '')), pl.platform) > 0
                       OR strpos(lower(coalesce(e.title, '')), pl.platform) > 0)
                  AND (p_to IS NULL OR e.date <= p_to)), 0),
      coalesce((SELECT sum(pp.amount)
                FROM platform_payouts pp
                WHERE pp.platform = pl.platform AND pp.currency = p_currency
                  AND (p_to IS NULL OR pp.date <= p_to)), 0)
    FROM (VALUES ('ebay'), ('amazon')) AS pl(platform)
    WHERE EXISTS (SELECT 1 FROM sales s WHERE s.platform = pl.platform AND s.currency = p_currency);
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_platform_running_balance(date, text) TO authenticated;
$$);
