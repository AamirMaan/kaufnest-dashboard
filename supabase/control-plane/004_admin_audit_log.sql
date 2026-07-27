-- ============================================================
-- Admin action audit log — control plane
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Records platform-admin actions that affect tenant access (currently just
-- impersonation) so there's a durable trail of who impersonated which
-- tenant's admin and when. See AUDIT_2026-07-24.md §2.4.
-- ============================================================

create table if not exists control.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action      text not null,           -- e.g. 'impersonate'
  tenant_id   uuid references control.tenants(id) on delete set null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_tenant_id on control.admin_audit_log (tenant_id);
create index if not exists idx_admin_audit_log_created_at on control.admin_audit_log (created_at desc);

alter table control.admin_audit_log enable row level security;

grant select, insert, update, delete on control.admin_audit_log to service_role;
