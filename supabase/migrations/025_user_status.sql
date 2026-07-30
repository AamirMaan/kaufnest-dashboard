-- ============================================================
-- Per-user active/deactivated status — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- Adds `status` to `profiles`: lets a super_admin deactivate a specific team
-- member (revoke dashboard access) without deleting their account or any
-- data they've created. This is deliberately NOT a hard delete — sales/
-- expenses/purchases/ebay_listing_drafts all have a NOT NULL created_by
-- REFERENCES profiles(id) with no cascade, so deleting a profile that has
-- ever created a record would fail with a foreign-key violation. Mirrors
-- the existing tenant-level deactivation pattern (control.tenants.status,
-- gated in src/proxy.ts) at the per-user level — see that same file's
-- updated RBAC block.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets this column from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.profiles
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'deactivated'));
$$);
