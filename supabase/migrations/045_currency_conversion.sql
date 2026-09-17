-- ============================================================
-- Currency conversion columns — every tenant schema (run_on_all_tenant_schemas)
--
-- A sheet row in a non-base currency (confirmed live: 24 Swedish orders on
-- tenant_k2_textil's May 2026 Amazon report booked as EUR instead of SEK,
-- overstating revenue by ~€3,320) now converts at import time instead of
-- being silently mis-booked. These four columns record the original figure
-- for audit; the existing money columns always hold base-currency amounts,
-- so every existing aggregation/export/invoice is untouched.
--
-- All four nullable. NULL means no conversion happened — a base-currency
-- row has all four null. See
-- docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
-- section 1 for the full design, including the ECB rate-direction formula
-- (rate(X -> base) = quote(base) / quote(X) — inverting this is the easiest
-- mistake here and it fails silently).
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets these from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS original_currency text,
    ADD COLUMN IF NOT EXISTS original_total_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
    ADD COLUMN IF NOT EXISTS fx_rate_date date;

  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS original_currency text,
    ADD COLUMN IF NOT EXISTS original_total_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
    ADD COLUMN IF NOT EXISTS fx_rate_date date;

  ALTER TABLE {{schema}}.purchases
    ADD COLUMN IF NOT EXISTS original_currency text,
    ADD COLUMN IF NOT EXISTS original_total_amount numeric(12,2),
    ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
    ADD COLUMN IF NOT EXISTS fx_rate_date date;
$$);
