-- ============================================================
-- FX rate cache — control plane (Project A)
--
-- Caches ECB daily reference rates so repeated imports/reviews don't
-- refetch the same date. Stores quote(C) exactly as the ECB publishes it —
-- units of currency C per 1 EUR — never a derived tenant-base-currency
-- pair rate, so this table needs no rebuild if a tenant's base currency
-- ever changes. FX rates are global reference data, not tenant data, hence
-- the control plane rather than a tenant schema.
--
-- See docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
-- section 1 for the conversion formula this feeds:
--   rate(X -> base) = quote(base) / quote(X)
-- ============================================================

CREATE TABLE IF NOT EXISTS control.fx_rates (
  rate_date  date NOT NULL,
  currency   text NOT NULL,
  quote      numeric(18,8) NOT NULL CHECK (quote > 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, currency)
);

GRANT SELECT, INSERT ON control.fx_rates TO service_role;
