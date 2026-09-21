-- supabase/migrations/046_expense_receipts.sql
-- ============================================================
-- Expense receipts — a private Storage bucket + the jsonb column that
-- indexes it.
--
-- An expense currently has nowhere to attach the invoice/receipt it was
-- entered from, so a tax audit can't follow the row back to its document.
-- See
-- docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
-- section 2 for the full design.
--
-- `receipts` is a jsonb array of `{ path, name, mime, size, uploaded_at }` —
-- a child table was considered and rejected: no join needed on the hot list
-- query, and it matches how `ebay_listing_drafts.image_urls`/listings'
-- `image_urls` already store an image set. Unlike that array, receipt
-- entries store a bare Storage PATH, not a URL — this bucket is private, so
-- there is no public URL to store; display goes through a signed URL
-- instead (`createSignedUrl`, 60s, see `expenses/_lib/receiptPath.ts`).
--
-- Bucket is PRIVATE (`public = false`) — the deliberate difference from
-- `listing-images` (022_listing_images_bucket.sql), which is public only
-- because eBay must fetch those URLs. A receipt is a financial document
-- with no such requirement.
--
-- Path convention `{tenant_schema}/{expense_id}/{uuid}.{ext}`, identical in
-- shape to `listing-images`' `{tenant_schema}/{draft_id}/{uuid}.{ext}` — the
-- tenant-schema prefix is load-bearing, the RLS policies below compare
-- `(storage.foldername(name))[1]` against the caller's JWT tenant_schema
-- claim.
--
-- Read is allowed to any authenticated member of the tenant (expenses are
-- not admin-only — `expenses_select`'s RLS has no role check either).
-- Insert/delete match the role that may EDIT an expense
-- (`expenses_update`'s RLS — any authenticated tenant member), not the
-- stricter admin/override-only `expenses_delete` — attaching or removing a
-- receipt is an edit to the expense row, not a delete of it.
--
-- Reuses `public.current_tenant_role()` (022_listing_images_bucket.sql) —
-- already schema-agnostic and already deployed. Unlike `listing-images`
-- (admin/super_admin-only write), any role at all clears the bar here, so
-- the check is `IS NOT NULL` rather than `IN (...)`: NULL means either no
-- tenant_schema claim or no matching profiles row (e.g. a since-deactivated
-- user whose JWT hasn't refreshed), and either way that's not "an
-- authenticated member of the tenant" — the same membership bar
-- `is_tenant_member()` enforces table-side for `expenses_select`, just
-- reached through the schema-agnostic wrapper storage policies must use.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets the column from the start. The
-- bucket itself needs no per-tenant provisioning (buckets are global,
-- exactly like listing-images).
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS receipts jsonb NOT NULL DEFAULT '[]'::jsonb;
$$);

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "expense_receipts_tenant_read" ON storage.objects;
CREATE POLICY "expense_receipts_tenant_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IS NOT NULL
  );

DROP POLICY IF EXISTS "expense_receipts_tenant_write" ON storage.objects;
CREATE POLICY "expense_receipts_tenant_write" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IS NOT NULL
  );

DROP POLICY IF EXISTS "expense_receipts_tenant_delete" ON storage.objects;
CREATE POLICY "expense_receipts_tenant_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IS NOT NULL
  );
