-- ============================================================
-- Migration 019: dropship_listings — tenant_kaufnest ONLY
-- (+ supplier price snapshot columns)
--
-- Supersedes supabase/009_dropship_listings.sql, which created the
-- table in `public`. That was wrong: Supabase clients are scoped to
-- the user's tenant schema via `db: { schema }`
-- (src/lib/supabase/server.ts), so PostgREST looked for
-- tenant_kaufnest.dropship_listings and failed with
-- "Could not find the table 'tenant_kaufnest.dropship_listings'".
--
-- DELIBERATELY NOT using run_on_all_tenant_schemas and NOT baked
-- into provision_tenant_schema(): dropshipping is a platform-admin-
-- only feature customised to the KaufNest tenant (SKU = AliExpress
-- item ID convention). The UI and API routes gate it via
-- verifyPlatformAdmin, so other tenants never query this table.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_kaufnest.dropship_listings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebay_listing_id           TEXT UNIQUE NOT NULL,
  title                     TEXT NOT NULL,
  image_url                 TEXT,
  ebay_url                  TEXT NOT NULL,
  current_price             NUMERIC(10,2) NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'EUR',
  sku                       TEXT,
  source_url                TEXT,
  source_platform           TEXT CHECK (source_platform IN ('amazon', 'aliexpress')),
  supplier_price            NUMERIC(10,2),
  supplier_currency         TEXT,
  supplier_price_checked_at TIMESTAMPTZ,
  last_synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed (created manually), still add the new columns.
ALTER TABLE tenant_kaufnest.dropship_listings
  ADD COLUMN IF NOT EXISTS supplier_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS supplier_currency TEXT,
  ADD COLUMN IF NOT EXISTS supplier_price_checked_at TIMESTAMPTZ;

ALTER TABLE tenant_kaufnest.dropship_listings ENABLE ROW LEVEL SECURITY;

-- Tenant members read/write; platform-admin gating is enforced at the API
-- routes (verifyPlatformAdmin), and eBay refresh additionally requires
-- manage_integrations (requireIntegrationAdmin).
DROP POLICY IF EXISTS "dropship_listings_select" ON tenant_kaufnest.dropship_listings;
CREATE POLICY "dropship_listings_select"
  ON tenant_kaufnest.dropship_listings FOR SELECT
  USING (tenant_kaufnest.is_tenant_member() AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "dropship_listings_insert" ON tenant_kaufnest.dropship_listings;
CREATE POLICY "dropship_listings_insert"
  ON tenant_kaufnest.dropship_listings FOR INSERT
  WITH CHECK (tenant_kaufnest.is_tenant_member() AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "dropship_listings_update" ON tenant_kaufnest.dropship_listings;
CREATE POLICY "dropship_listings_update"
  ON tenant_kaufnest.dropship_listings FOR UPDATE
  USING (tenant_kaufnest.is_tenant_member() AND auth.role() = 'authenticated');

-- ── Best-effort data migration from the old public table ─────
-- If public.dropship_listings exists (from 009), copy its rows into
-- tenant_kaufnest, then drop the public table so nothing queries it
-- by accident.
DO $migrate$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dropship_listings'
  ) THEN
    INSERT INTO tenant_kaufnest.dropship_listings
      (id, ebay_listing_id, title, image_url, ebay_url, current_price,
       currency, sku, source_url, source_platform, last_synced_at, created_at)
    SELECT
      id, ebay_listing_id, title, image_url, ebay_url, current_price,
      currency, sku, source_url, source_platform, last_synced_at, created_at
    FROM public.dropship_listings
    ON CONFLICT (ebay_listing_id) DO NOTHING;

    DROP TABLE public.dropship_listings;
    RAISE NOTICE 'Migrated public.dropship_listings into tenant_kaufnest and dropped the public table';
  END IF;
END
$migrate$;
