-- ============================================================
-- Table summary functions — every tenant schema (run_on_all_tenant_schemas)
--
-- Back the summary tiles above the Orders / Purchases / Expenses tables.
-- Each aggregates EVERY row matching the table's active filters (not just
-- the visible page) and returns one row per currency — structurally
-- bounded by the number of currencies in use, so no pagination.
--
-- Parameters mirror the client's `xFilterParams()` mappers
-- (src/app/dashboard/*/_store/*FilterParams.ts) exactly; NULL = filter not
-- applied. `p_pattern` arrives already wrapped in wildcards with LIKE
-- metacharacters escaped (`ilikePattern()` in src/lib/utils/filters.ts) —
-- that keeps any literal percent sign out of this SQL, which matters for the
-- format()-based copy in 005_tenant_provisioning.sql.
--
-- Orders: money columns exclude returned/cancelled rows unless a status
-- filter is set (then the filtered rows ARE the result). excluded_count is
-- only non-zero when no status filter is set.
--
-- Not SECURITY DEFINER: runs as the caller, so the existing *_select RLS
-- policies gate visibility — same as 045_overview_aggregation_functions.sql.
-- Also baked into provision_tenant_schema() (005, same commit).
-- See docs/superpowers/specs/2026-09-26-summary-tiles-receipt-autofill-overview-charts-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_summary(
    p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text
  )
  RETURNS TABLE (
    currency text, order_count int, gross numeric, vat numeric,
    fees numeric, shipping_charged numeric, excluded_count int
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
      (count(*) FILTER (WHERE NOT f.counts))::int
    FROM filtered f
    GROUP BY f.currency
    ORDER BY f.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_summary(date, date, text, text, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_purchases_summary(
    p_from date, p_to date, p_currency text, p_pattern text
  )
  RETURNS TABLE (currency text, purchase_count int, units numeric, gross numeric, vat numeric)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT
      p.currency,
      count(*)::int,
      coalesce(sum(p.quantity), 0),
      coalesce(sum(p.total_amount), 0),
      coalesce(sum(coalesce(p.vat_amount, 0)), 0)
    FROM purchases p
    WHERE (p_from IS NULL OR p.date >= p_from)
      AND (p_to IS NULL OR p.date <= p_to)
      AND (p_currency IS NULL OR p.currency = p_currency)
      AND (p_pattern IS NULL
           OR p.product_name ILIKE p_pattern
           OR p.vendor ILIKE p_pattern
           OR p.description ILIKE p_pattern)
    GROUP BY p.currency
    ORDER BY p.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_purchases_summary(date, date, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_expenses_summary(
    p_from date, p_to date, p_category text, p_currency text, p_pattern text
  )
  RETURNS TABLE (
    currency text, expense_count int, gross numeric, vat numeric,
    top_category text, top_category_amount numeric
  )
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT e.*
      FROM expenses e
      WHERE (p_from IS NULL OR e.date >= p_from)
        AND (p_to IS NULL OR e.date <= p_to)
        AND (p_category IS NULL OR e.category = p_category)
        AND (p_currency IS NULL OR e.currency = p_currency)
        AND (p_pattern IS NULL
             OR e.title ILIKE p_pattern
             OR e.vendor ILIKE p_pattern
             OR e.description ILIKE p_pattern
             OR e.invoice_number ILIKE p_pattern)
    ),
    totals AS (
      SELECT currency, count(*)::int AS cnt, sum(amount) AS gross,
             sum(coalesce(vat_amount, 0)) AS vat
      FROM filtered
      GROUP BY currency
    ),
    by_category AS (
      SELECT currency, category, sum(amount) AS amt,
             row_number() OVER (PARTITION BY currency ORDER BY sum(amount) DESC, category) AS rn
      FROM filtered
      GROUP BY currency, category
    )
    SELECT t.currency, t.cnt, coalesce(t.gross, 0), coalesce(t.vat, 0), c.category, c.amt
    FROM totals t
    LEFT JOIN by_category c ON c.currency = t.currency AND c.rn = 1
    ORDER BY t.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_expenses_summary(date, date, text, text, text) TO authenticated;
$$);
