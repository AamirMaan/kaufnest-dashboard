-- ============================================================
-- 038 — origin column on ebay_listing_drafts, for imported eBay listings
--
-- Listings this app didn't create (imported via a new "Sync from eBay"
-- action, or created by this app before this feature existed) need to be
-- distinguished from ones the wizard created, so the UI knows whether
-- clicking a row should open the wizard (draft/failed, app-created only)
-- or the new Trading-API edit page (anything already published).
--
-- Also adds a full (non-partial) unique index on ebay_listing_id, needed
-- for the sync route's upsert(onConflict: "ebay_listing_id"). Deliberately
-- NOT partial — a partial index breaks Supabase's upsert onConflict
-- inference, and multiple NULLs (unpublished drafts) never conflict under
-- a plain UNIQUE index anyway. See 033_ebay_messages_full_unique_index.sql
-- for the exact mistake this avoids repeating for a different table.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    add column if not exists origin text not null default 'app'
      check (origin in ('app', 'ebay_import'));

  create unique index if not exists idx_ebay_listing_drafts_ebay_listing_id
    on {{schema}}.ebay_listing_drafts (ebay_listing_id);
$$);
