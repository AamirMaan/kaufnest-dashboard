-- ============================================================
-- 039 — "inactive" status on ebay_listing_drafts, for listings that ended
-- on eBay
--
-- Three routes (end, sync's reconciliation, ebay-detail's self-correction —
-- see dashboard/listings/CLAUDE.md) used to hard-delete a local row once a
-- listing was confirmed gone from eBay. That threw away real history: a
-- tenant deleting a listing, or eBay ending one behind their back, left no
-- trace it ever existed. All three now update status to 'inactive' instead,
-- so the Listings page can keep showing it (filtered out of the default
-- "Active" view, visible under an "Inactive" filter).
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    drop constraint if exists ebay_listing_drafts_status_check;

  alter table {{schema}}.ebay_listing_drafts
    add constraint ebay_listing_drafts_status_check
      check (status in ('draft', 'publishing', 'published', 'failed', 'inactive'));
$$);
