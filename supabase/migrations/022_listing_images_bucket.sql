-- supabase/migrations/022_listing_images_bucket.sql
-- ============================================================
-- Storage bucket for eBay listing images.
-- Run this in the Supabase SQL editor for Project B.
--
-- Public read (eBay must be able to fetch the image URLs), write/delete
-- restricted to authenticated admin/super_admin of the tenant that owns the
-- path prefix. Path convention: {tenant_schema}/{draft_id}/{filename}.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

-- Schema-agnostic role lookup: reads the caller's tenant_schema from their
-- JWT, then dynamically queries that schema's profiles table. Distinct from
-- each tenant schema's own current_user_role() (defined inside
-- provision_tenant_schema()), which only works when already connected with
-- that schema set via db.schema — storage policies have no such context.
CREATE OR REPLACE FUNCTION public.current_tenant_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schema_name text;
  role_value text;
BEGIN
  schema_name := auth.jwt() -> 'app_metadata' ->> 'tenant_schema';
  IF schema_name IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT role FROM %I.profiles WHERE id = auth.uid()', schema_name)
    INTO role_value;
  RETURN role_value;
END;
$$;

DROP POLICY IF EXISTS "listing_images_public_read" ON storage.objects;
CREATE POLICY "listing_images_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'listing-images');

DROP POLICY IF EXISTS "listing_images_tenant_admin_write" ON storage.objects;
CREATE POLICY "listing_images_tenant_admin_write" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'listing-images'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "listing_images_tenant_admin_delete" ON storage.objects;
CREATE POLICY "listing_images_tenant_admin_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'listing-images'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IN ('admin', 'super_admin')
  );
