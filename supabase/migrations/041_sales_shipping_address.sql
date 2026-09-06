-- ============================================================
-- 041 — buyer shipping address capture on sales
--
-- Nine new nullable columns on `sales`: buyer_name, shipping_address_line1,
-- shipping_address_line2, shipping_city, shipping_state,
-- shipping_postal_code, shipping_country, buyer_phone, buyer_email.
--
-- Captured automatically when an order is synced from eBay (Review Orders
-- import — see src/lib/integrations/ebay.ts's fetchOrders, which reads
-- fulfillmentStartInstructions[].shippingStep.shipTo), and editable/
-- enterable by hand on any sale (any platform) via a new "Shipping Address
-- (optional)" section in AddSaleModal/EditSaleModal.
--
-- All nine are USER-OWNED fields for the re-import merge rule
-- (mergeImportedSale.ts) — a seller's manual correction to a wrong or
-- incomplete address must survive a later re-sync of the same order.
--
-- shipping_country is free text on purpose (not a fixed-list Select) — eBay
-- returns a 2-letter ISO 3166-1 alpha-2 code, a manual entry might not;
-- validation is deferred to the future label-purchase feature that actually
-- needs a valid country code, same pattern as `referral`'s free-text
-- rationale (control-plane 009_tenants_referral.sql).
--
-- Amazon adapter is NOT touched — Amazon's SP-API order-address endpoint
-- needs a separate PII-access grant this app doesn't request yet; its
-- NormalizedOrders simply leave `shipping` undefined, and mapToSale.ts
-- already treats an absent field as "no data" (all nine columns null).
--
-- See docs/superpowers/specs/2026-09-04-buyer-shipping-address-design.md.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists buyer_name text,
    add column if not exists shipping_address_line1 text,
    add column if not exists shipping_address_line2 text,
    add column if not exists shipping_city text,
    add column if not exists shipping_state text,
    add column if not exists shipping_postal_code text,
    add column if not exists shipping_country text,
    add column if not exists buyer_phone text,
    add column if not exists buyer_email text;
$$);
