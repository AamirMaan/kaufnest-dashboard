-- ============================================================
-- Migration 019: dropship_listings — all tenant schemas
-- (+ supplier price snapshot columns)
--
-- Supersedes supabase/009_dropship_listings.sql, which created the
-- table in `public`. That was wrong for this app: Supabase clients
-- are scoped to the user's tenant schema via `db: { schema }`
-- (src/lib/supabase/server.ts), so PostgREST looked for
-- tenant_<x>.dropship_listings and failed with
-- "Could not find the table 'tenant_kaufnest.dropship_listings'".
--
-- Uses run_on_all_tenant_schemas (installed in 012) for live
-- tenants. Also baked into provision_tenant_schema() in
-- 005_tenant_provisioning.sql for new tenants.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.dropship_listings (
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

  -- Existing schemas that already have the table (e.g. created manually)
  -- still get the new supplier columns.
  ALTER TABLE {{schema}}.dropship_listings
    ADD COLUMN IF NOT EXISTS supplier_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS supplier_currency TEXT,
    ADD COLUMN IF NOT EXISTS supplier_price_checked_at TIMESTAMPTZ;

  ALTER TABLE {{schema}}.dropship_listings ENABLE ROW LEVEL SECURITY;

  -- All tenant members read; all tenant members write (source-URL linking and
  -- price checks are data-entry tasks). eBay refresh is additionally guarded
  -- admin-only at the API route (requireIntegrationAdmin).
  DROP POLICY IF EXISTS "dropship_listings_select" ON {{schema}}.dropship_listings;
  CREATE POLICY "dropship_listings_select"
    ON {{schema}}.dropship_listings FOR SELECT
    USING ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "dropship_listings_insert" ON {{schema}}.dropship_listings;
  CREATE POLICY "dropship_listings_insert"
    ON {{schema}}.dropship_listings FOR INSERT
    WITH CHECK ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "dropship_listings_update" ON {{schema}}.dropship_listings;
  CREATE POLICY "dropship_listings_update"
    ON {{schema}}.dropship_listings FOR UPDATE
    USING ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');
$$);

-- ── Best-effort data migration from the old public table ─────
-- If public.dropship_listings exists (from 009), copy its rows into
-- tenant_kaufnest (the only tenant that used dropshipping so far),
-- then drop the public table so nothing queries it by accident.
DO $migrate$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dropship_listings'
  ) AND EXISTS (
    SELECT FROM information_schema.schemata WHERE schema_name = 'tenant_kaufnest'
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
