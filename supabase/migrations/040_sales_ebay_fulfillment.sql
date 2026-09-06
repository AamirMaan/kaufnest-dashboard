-- ============================================================
-- 040 — eBay order status push-back: tracking/carrier + sync state on sales
--
-- Piece 1 of 4 in the "eBay order fulfillment" decomposition. Backs pushing
-- a local sales.status change ("shipped"/"cancelled") on an eBay-sourced
-- order out to eBay's Fulfillment API
-- (POST /api/integrations/ebay/orders/[saleId]/sync-status). Five nullable
-- columns, purely additive — every existing row gets NULL for all five, no
-- backfill needed.
--
-- tracking_number / shipping_carrier: captured in EditSaleModal when a
--   sale's status is set to "shipped" on an eBay-sourced order; eBay's
--   createShippingFulfillment call requires both.
-- ebay_fulfillment_id: eBay's returned fulfillmentId once a "shipped" sync
--   succeeds.
-- ebay_sync_error: the last push-back failure message, if the most recent
--   sync attempt failed; cleared on the next successful sync. Drives the
--   retry row on the order detail page.
-- ebay_synced_at: timestamp of the last successful sync.
--
-- Also mirrored into provision_tenant_schema() (005) in the same commit —
-- the "2 places" rule, see supabase/SKILL.md.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists tracking_number text,
    add column if not exists shipping_carrier text,
    add column if not exists ebay_fulfillment_id text,
    add column if not exists ebay_sync_error text,
    add column if not exists ebay_synced_at timestamptz;
$$);
