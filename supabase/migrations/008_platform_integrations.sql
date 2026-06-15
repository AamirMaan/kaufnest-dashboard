-- ============================================================
-- Platform integrations (eBay/Amazon) — tenant_kaufnest schema
-- Run this in the Supabase SQL editor for Project B.
--
-- Adds platform_connections (OAuth tokens + sync status per platform) and
-- sales.external_order_id (dedup key for platform-synced orders).
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets these from the start — this file only needs to run
-- for tenant_kaufnest, which was provisioned before they existed.
--
-- CREATE TABLE/ADD COLUMN/CREATE INDEX all use IF NOT EXISTS — safe to run
-- against the live schema. CREATE POLICY has no IF NOT EXISTS, so this file
-- drops the policy first if it already exists (retry-safe).
-- ============================================================

create table if not exists tenant_kaufnest.platform_connections (
  id                   uuid primary key default gen_random_uuid(),
  platform             text not null check (platform in ('ebay', 'amazon')),
  status               text not null default 'disconnected'
                         check (status in ('connected', 'disconnected', 'error')),
  access_token         text,
  refresh_token        text,
  token_expires_at     timestamptz,
  external_account_id  text,
  marketplace_id       text,
  last_synced_at       timestamptz,
  last_sync_status     text,
  last_sync_error      text,
  connected_by         uuid references tenant_kaufnest.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (platform)
);

create or replace trigger set_platform_connections_updated_at
  before update on tenant_kaufnest.platform_connections
  for each row execute procedure public.set_updated_at();

alter table tenant_kaufnest.sales
  add column if not exists external_order_id text;

-- Non-partial unique index: Postgres treats multiple NULLs as distinct, so
-- existing/manually-created sales (external_order_id IS NULL) are
-- unaffected, while platform-synced rows can be upserted idempotently via
-- .upsert(rows, { onConflict: "platform,external_order_id" }).
create unique index if not exists idx_sales_platform_external_order_id
  on tenant_kaufnest.sales (platform, external_order_id);

alter table tenant_kaufnest.platform_connections enable row level security;

drop policy if exists "platform_connections_all_admin" on tenant_kaufnest.platform_connections;

create policy "platform_connections_all_admin" on tenant_kaufnest.platform_connections
  for all
  using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'))
  with check (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));
