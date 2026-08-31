-- ============================================================
-- 037 — required item aspects on ebay_listing_drafts
--
-- Some eBay categories require specific item aspects (e.g. Brand — "Marke"
-- on EBAY_DE, per Content-Language) before publishOffer will succeed;
-- confirmed live 2026-08-31 against tenant_kaufnest's "Vitamine &
-- Mineralien" category (errorId 25002, "Das Artikelmerkmal Marke fehlt").
-- Which aspects are required varies per category, so it's fetched live from
-- eBay's Taxonomy API (getItemAspectsForCategory) once a category is picked
-- — see fetchRequiredAspects in publish.ts and the wizard's new Aspects
-- step — and the tenant's chosen values are stored here as a flat
-- name -> value map (single value per aspect; this app doesn't support
-- eBay's MULTI-cardinality aspects in v1).
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    add column if not exists aspects jsonb not null default '{}'::jsonb;
$$);
