-- ============================================================
-- 044 — pricing, offers and marketing on ebay_listing_drafts
--
-- Lets the create-listing form carry everything a seller would otherwise
-- finish in eBay Seller Hub: VAT %, Best Offer (+ auto-accept/decline),
-- a multi-buy volume discount (Buy 2 / 3 / 4+), and a Promoted Listings
-- cost-per-sale ad rate + campaign. The ebay_ad_id / ebay_promotion_id
-- columns record what eBay actually created after publish, so the
-- apply-marketing retry can skip steps that already succeeded;
-- marketing_error holds the last post-publish failure (the listing itself
-- stays published). See
-- docs/superpowers/specs/2026-09-11-ebay-listing-pricing-marketing-design.md.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    add column if not exists vat_percentage numeric(5,2)
      check (vat_percentage is null or (vat_percentage >= 0 and vat_percentage <= 100)),
    add column if not exists best_offer_enabled boolean not null default false,
    add column if not exists best_offer_auto_accept numeric(12,2)
      check (best_offer_auto_accept is null or best_offer_auto_accept > 0),
    add column if not exists best_offer_auto_decline numeric(12,2)
      check (best_offer_auto_decline is null or best_offer_auto_decline > 0),
    add column if not exists multibuy_2_pct smallint
      check (multibuy_2_pct is null or multibuy_2_pct between 1 and 80),
    add column if not exists multibuy_3_pct smallint
      check (multibuy_3_pct is null or multibuy_3_pct between 1 and 80),
    add column if not exists multibuy_4_pct smallint
      check (multibuy_4_pct is null or multibuy_4_pct between 1 and 80),
    add column if not exists ad_rate numeric(4,1)
      check (ad_rate is null or ad_rate between 2 and 100),
    add column if not exists ad_campaign_id text,
    add column if not exists ebay_ad_id text,
    add column if not exists ebay_promotion_id text,
    add column if not exists marketing_error text;

  alter table {{schema}}.ebay_listing_drafts
    drop constraint if exists ebay_listing_drafts_best_offer_order;
  alter table {{schema}}.ebay_listing_drafts
    add constraint ebay_listing_drafts_best_offer_order check (
      best_offer_auto_accept is null
      or best_offer_auto_decline is null
      or best_offer_auto_decline < best_offer_auto_accept
    );
$$);
