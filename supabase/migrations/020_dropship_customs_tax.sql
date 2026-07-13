-- ============================================================
-- Migration 020: EU customs tax on dropship listings
-- (tenant_kaufnest ONLY — see 019_dropship_supplier_price.sql's header
-- comment: dropship_listings is deliberately excluded from
-- provision_tenant_schema() and run_on_all_tenant_schemas, since this
-- is a platform-admin-only feature customised to the KaufNest tenant.)
--
-- Adds a per-listing customs tax rate (entered manually — rates vary by
-- product category/TARIC code, no sensible company-wide default) and a
-- derived amount column, so the margin calculation can account for the
-- EU's removal of the duty-free de minimis threshold on low-value imports.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE tenant_kaufnest.dropship_listings
  ADD COLUMN IF NOT EXISTS customs_tax_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS customs_tax_amount NUMERIC(12,2);
