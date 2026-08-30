-- ============================================================
-- 036 — per-draft merchant_location_key on ebay_listing_drafts
--
-- publish.ts previously read a single global EBAY_MERCHANT_LOCATION_KEY env
-- var for every tenant's offer creation. A merchant location belongs to one
-- specific eBay seller account, so that only ever worked for whichever one
-- tenant's key happened to be configured — every other tenant's publish
-- attempt would fail at eBay's publishOffer step with errorId 25002 ("no
-- Item.Country exists"), since an offer with no valid location has no
-- country to build a listing from. Confirmed live 2026-08-30 against
-- tenant_kaufnest's first real publish attempt.
--
-- Fixed the same way fulfillment/payment/return policies already are:
-- fetched live per-tenant from eBay's own API
-- (GET /sell/inventory/v1/location, via the tenant's own sell.inventory-
-- scoped token — no new OAuth consent needed) and chosen per-draft in the
-- wizard, not configured once globally. This column stores that choice.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    add column if not exists merchant_location_key text;
$$);
