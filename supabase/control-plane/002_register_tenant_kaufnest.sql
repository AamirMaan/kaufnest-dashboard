-- ============================================================
-- Phase 2 — Register the first tenant in the control plane
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control),
-- AFTER supabase/migrations/004_phase2_tenant_kaufnest.sql has been run
-- successfully against PROJECT B.
-- ============================================================

insert into control.tenants (name, slug, schema_name, plan, status)
values ('KaufNest', 'kaufnest', 'tenant_kaufnest', 'business', 'active');
