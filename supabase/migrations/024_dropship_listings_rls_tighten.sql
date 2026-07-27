-- ============================================================
-- Tighten dropship_listings RLS — tenant_kaufnest ONLY (direct ALTER, same
-- documented exception as 019/020_dropship_*.sql — this table doesn't exist
-- in other tenant schemas, so run_on_all_tenant_schemas doesn't apply).
--
-- See AUDIT_2026-07-24.md §2.5: the SELECT/INSERT/UPDATE policies from
-- 019_dropship_supplier_price.sql allowed ANY authenticated tenant member
-- (including "accountant" role) to read/write this table directly via the
-- Supabase client, even though the feature is intended to be platform-admin
-- only — the API routes (verifyPlatformAdmin) were the only real gate.
--
-- IMPORTANT LIMITATION: "platform admin" (control.admin_users) lives in a
-- DIFFERENT Supabase project (Project A) than this table (Project B) — RLS
-- in Postgres cannot query across projects, so it's not possible for these
-- policies to check control.admin_users directly. This migration instead
-- restricts to the tenant-level admin/super_admin role (same bar as
-- products/expenses/purchases/sales DELETE policies), which is the closest
-- DB-level approximation achievable and closes the "any accountant can read
-- this table" gap. The API layer (verifyPlatformAdmin) remains the actual
-- platform-admin boundary — this is defense-in-depth, not a full replacement.
-- ============================================================

DROP POLICY IF EXISTS "dropship_listings_select" ON tenant_kaufnest.dropship_listings;
CREATE POLICY "dropship_listings_select"
  ON tenant_kaufnest.dropship_listings FOR SELECT
  USING (
    tenant_kaufnest.is_tenant_member()
    AND tenant_kaufnest.current_user_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "dropship_listings_insert" ON tenant_kaufnest.dropship_listings;
CREATE POLICY "dropship_listings_insert"
  ON tenant_kaufnest.dropship_listings FOR INSERT
  WITH CHECK (
    tenant_kaufnest.is_tenant_member()
    AND tenant_kaufnest.current_user_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "dropship_listings_update" ON tenant_kaufnest.dropship_listings;
CREATE POLICY "dropship_listings_update"
  ON tenant_kaufnest.dropship_listings FOR UPDATE
  USING (
    tenant_kaufnest.is_tenant_member()
    AND tenant_kaufnest.current_user_role() IN ('admin', 'super_admin')
  );

-- No DELETE policy exists (and none is added here) — RLS default-denies
-- DELETE with no matching policy, which was already the case before this
-- migration.
