-- ============================================================
-- Control plane schema — Phase 1, Step 1.4
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
-- Already applied — kept here for reproducibility / disaster recovery.
-- ============================================================

create schema if not exists control;

create table control.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,          -- used as schema name: tenant_<slug>
  schema_name   text not null unique,          -- e.g. tenant_acme
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan          text not null default 'trial', -- trial | starter | pro | business
  status        text not null default 'active',-- active | inactive | cancelled
  trial_ends_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table control.admin_users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  can_impersonate  boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Seed yourself as the first admin
insert into control.admin_users (email) values ('muhammadaamir.sohail94@gmail.com');

-- Auto-update updated_at
create or replace function control.set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger tenants_updated_at
  before update on control.tenants
  for each row execute function control.set_updated_at();

-- Enable RLS (service-role key bypasses this; blocks anon/authenticated by default)
alter table control.tenants enable row level security;
alter table control.admin_users enable row level security;

-- ============================================================
-- Register tenant_kaufnest (Phase 2)
-- Run AFTER supabase/migrations/006_bootstrap_tenant_kaufnest.sql has been
-- applied successfully in PROJECT B. Merged from the former
-- 002_register_tenant_kaufnest.sql.
-- ============================================================

insert into control.tenants (name, slug, schema_name, plan, status)
values ('KaufNest', 'kaufnest', 'tenant_kaufnest', 'business', 'active');
