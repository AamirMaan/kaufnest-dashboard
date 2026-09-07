-- ============================================================
-- Add shipping_labels_enabled to control.tenants
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Per-tenant on/off switch for EasyPost shipping-label purchasing
-- (src/lib/shipping/), mirroring the ai_enabled pattern (007). Defaults to
-- FALSE: EasyPost purchasing has no plan tie and no per-tenant credential
-- yet (every tenant currently shares one platform EASYPOST_API_KEY) — see
-- docs/superpowers/specs/2026-09-07-shipping-label-gating-and-detail-layout-design.md.
-- A platform admin flips this on per tenant from /admin once that tenant is
-- ready to purchase real labels. Until then, the order-detail page falls
-- back to a free plain sender/receiver PDF label instead.
-- ============================================================

alter table control.tenants
  add column if not exists shipping_labels_enabled boolean not null default false;
