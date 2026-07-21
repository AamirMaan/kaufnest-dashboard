-- ============================================================
-- eBay listing drafts — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- A draft can be sourced from an Inventory product OR a third-party
-- (dropship) supplier URL — exactly one of product_id/source_url is set,
-- enforced at the application layer (see wizardValidation.ts), not a DB
-- CHECK, to keep the migration simple and match how product_id nullability
-- already works on sales/purchases.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets this table from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.ebay_listing_drafts (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type            text NOT NULL CHECK (source_type IN ('inventory', 'dropship')),
    product_id             uuid REFERENCES {{schema}}.products(id),
    source_url             text,
    source_platform        text,
    title                  text NOT NULL,
    description            text,
    price                  numeric(12,2) NOT NULL CHECK (price >= 0),
    currency               text NOT NULL DEFAULT 'EUR',
    quantity               integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    condition              text NOT NULL CHECK (condition IN ('new', 'used', 'refurbished')),
    category_id            text,
    category_name          text,
    image_urls             text[] NOT NULL DEFAULT '{}',
    fulfillment_policy_id  text,
    payment_policy_id      text,
    return_policy_id       text,
    ebay_sku               text,
    status                 text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
    ebay_offer_id          text,
    ebay_listing_id        text,
    publish_error          text,
    created_by             uuid NOT NULL REFERENCES {{schema}}.profiles(id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
  );

  CREATE OR REPLACE TRIGGER set_ebay_listing_drafts_updated_at
    BEFORE UPDATE ON {{schema}}.ebay_listing_drafts
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

  CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_status
    ON {{schema}}.ebay_listing_drafts (status);
  CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_created_by
    ON {{schema}}.ebay_listing_drafts (created_by);

  ALTER TABLE {{schema}}.ebay_listing_drafts ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "ebay_listing_drafts_all_admin" ON {{schema}}.ebay_listing_drafts;
  CREATE POLICY "ebay_listing_drafts_all_admin" ON {{schema}}.ebay_listing_drafts
    FOR ALL
    USING ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'))
    WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));
$$);
