-- ============================================================
-- 031 — sales.refunded_amount
--
-- Amazon REFUND rows deduct from the sale they belong to rather than becoming
-- their own row: `sales_unit_price_check (unit_price >= 0)` rejects a negative
-- unit price, and `idx_sales_platform_external_order_id` is a NON-partial
-- unique index, while every refund shares its order id with its own sale.
--
-- This column is the idempotency marker. A sale whose refunded_amount is
-- already set is skipped on re-import instead of being deducted a second time.
--
-- Also baked into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists refunded_amount numeric(12,2)
      check (refunded_amount >= 0);
$$);
