-- Migration 009: dropship_listings table
-- Stores tenant's active eBay listings with optional supplier source URL.
-- Lives in public schema (consistent with all current tenant tables).

CREATE TABLE IF NOT EXISTS public.dropship_listings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ebay_listing_id   text        UNIQUE NOT NULL,
  title             text        NOT NULL,
  image_url         text,
  ebay_url          text        NOT NULL,
  current_price     numeric(10,2) NOT NULL,
  currency          text        NOT NULL DEFAULT 'EUR',
  sku               text,
  source_url        text,
  source_platform   text        CHECK (source_platform IN ('amazon', 'aliexpress')),
  last_synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- RLS: same pattern as platform_connections — tenant users only
ALTER TABLE public.dropship_listings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (accountants need read access)
CREATE POLICY "tenant_select_dropship_listings"
  ON public.dropship_listings
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admin/super_admin can insert/update (enforced by API route auth guard)
-- Using the same approach as other tables: RLS allows authenticated, route enforces role
CREATE POLICY "tenant_insert_dropship_listings"
  ON public.dropship_listings
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tenant_update_dropship_listings"
  ON public.dropship_listings
  FOR UPDATE
  USING (auth.role() = 'authenticated');
