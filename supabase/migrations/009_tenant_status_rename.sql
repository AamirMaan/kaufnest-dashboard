-- supabase/migrations/009_tenant_status_rename.sql
-- Rename tenant status values and update CHECK constraint.
-- Apply to: Project A (control plane Supabase project).

UPDATE control.tenants SET status = 'invited'     WHERE status = 'inactive';
UPDATE control.tenants SET status = 'deactivated' WHERE status = 'cancelled';

ALTER TABLE control.tenants
  DROP CONSTRAINT IF EXISTS tenants_status_check,
  ADD  CONSTRAINT tenants_status_check
       CHECK (status IN ('invited', 'active', 'deactivated'));
