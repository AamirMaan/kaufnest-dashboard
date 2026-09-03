-- supabase/control-plane/007_tenant_ai_usage.sql
-- ============================================================
-- AI feature visibility + per-tenant, per-user AI usage metering.
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- ai_enabled defaults to TRUE: the plan grants AI (hasAiFeatures), this
-- column only lets a platform admin REVOKE it for one tenant. Defaulting
-- false would hide a capability the Business plan already advertises.
-- ============================================================

alter table control.tenants
  add column if not exists ai_enabled boolean not null default true;

create table if not exists control.tenant_ai_usage (
  tenant_id     uuid not null references control.tenants(id) on delete cascade,
  -- Project B auth user id. Deliberately no FK: auth lives in a different
  -- database, so cross-project referential integrity is unavailable.
  user_id       uuid not null,
  period        date not null,            -- first day of the billing month, UTC
  kind          text not null check (kind in ('describe','aspects')),
  calls         integer not null default 0,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, user_id, period, kind)
);

create index if not exists idx_tenant_ai_usage_period
  on control.tenant_ai_usage (tenant_id, period);

-- Service-role key bypasses RLS; this blocks anon/authenticated by default,
-- matching control.tenants and control.admin_users.
alter table control.tenant_ai_usage enable row level security;
