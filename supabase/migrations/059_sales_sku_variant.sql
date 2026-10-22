-- supabase/migrations/059_sales_sku_variant.sql
-- ============================================================
-- 059 — sales.sku + sales.variant_text
-- Design: docs/superpowers/specs/2026-10-22-review-orders-variants-inventory-link-design.md
--
-- Seller SKU and flattened variation aspects ("Size: M · Colour: Red") copied
-- from the platform order at import. Fill-only on re-sync (mergeImportedSale).
-- Plain nullable text; no index (never filtered on).
-- Mirrored into provision_tenant_schema() (005).
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS sku text,
    ADD COLUMN IF NOT EXISTS variant_text text;
$$);
