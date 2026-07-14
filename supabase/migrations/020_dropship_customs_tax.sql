-- ============================================================
-- Migration 020: EU customs tax on dropship listings
-- (tenant_kaufnest ONLY — see 019_dropship_supplier_price.sql's header
-- comment: dropship_listings is deliberately excluded from
-- provision_tenant_schema() and run_on_all_tenant_schemas, since this
-- is a platform-admin-only feature customised to the KaufNest tenant.)
--
-- Adds a flat per-listing EU customs handling fee, defaulting to 3 (the
-- typical flat fee for low-value parcels now that the EU has removed the
-- duty-free de minimis threshold on imports). The DEFAULT applies to every
-- existing row as well as new ones, so nothing needs to backfill it
-- separately. Editable per listing when the actual fee differs.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE tenant_kaufnest.dropship_listings
  ADD COLUMN IF NOT EXISTS customs_tax_amount NUMERIC(12,2) NOT NULL DEFAULT 3;
