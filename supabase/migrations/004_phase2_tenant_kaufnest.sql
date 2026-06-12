-- ============================================================
-- Phase 2 — Schema-per-tenant isolation
-- Run this in the Supabase SQL editor for PROJECT B (your existing project),
-- AFTER running 003_saas_functions.sql in the same project (this script calls
-- public.set_user_tenant from 003 in step 9).
--
-- What this does:
--   1. Creates the tenant_kaufnest schema (your own company = first tenant)
--   2. Creates all tables (mirrors supabase/tenant-schema-template.sql)
--   3. Adds updated_at + stock-sync triggers, RLS policies, indexes
--   4. Copies existing public.* data into tenant_kaufnest.*
--   5. Seeds tenant_kaufnest.company_profile
--   6. Stamps every existing auth.users row with tenant_schema='tenant_kaufnest'
--
-- Do NOT drop public.* tables yet (Phase 3.6, only after browser testing).
--
-- NOTE: after step 9 runs, existing logged-in sessions won't see the new
-- app_metadata.tenant_schema until their JWT refreshes (log out/in to force
-- it) — until then, RLS below will deny them via is_tenant_member().
-- ============================================================

create extension if not exists pgcrypto;

-- ─── 1. Schema ─────────────────────────────────────────────────
create schema if not exists tenant_kaufnest;

-- ─── 2. Tables (mirrors supabase/tenant-schema-template.sql) ──

create table tenant_kaufnest.profiles (
  id         uuid primary key,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'accountant'
               check (role in ('super_admin', 'admin', 'accountant')),
  created_at timestamptz not null default now()
);

create table tenant_kaufnest.products (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  sku               text,
  current_stock     integer not null default 0,
  reorder_threshold integer,
  created_by        uuid not null references tenant_kaufnest.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table tenant_kaufnest.expenses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  currency    text not null default 'EUR',
  category    text not null,
  vendor      text,
  date        date not null,
  description text,
  created_by  uuid not null references tenant_kaufnest.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  vat_rate    numeric(5,2),
  vat_amount  numeric(12,2)
);

create table tenant_kaufnest.sales (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null,
  product_name text not null,
  product_id   uuid references tenant_kaufnest.products(id) on delete set null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  total_amount numeric(12,2) not null,
  currency     text not null default 'EUR',
  date         date not null,
  description  text,
  created_by   uuid not null references tenant_kaufnest.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  vat_rate     numeric(5,2),
  vat_amount   numeric(12,2)
);

create table tenant_kaufnest.purchases (
  id           uuid primary key default gen_random_uuid(),
  product_name text not null,
  product_id   uuid references tenant_kaufnest.products(id) on delete set null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  total_amount numeric(12,2) not null,
  currency     text not null default 'EUR',
  vendor       text,
  date         date not null,
  description  text,
  created_by   uuid not null references tenant_kaufnest.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  vat_rate     numeric(5,2),
  vat_amount   numeric(12,2)
);

-- NOTE: user_id is nullable here (unlike tenant-schema-template.sql) to match
-- public.audit_logs, which allows null on `on delete set null`.
create table tenant_kaufnest.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  user_email  text,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create table tenant_kaufnest.company_profile (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  logo_url   text,
  vat_number text,
  address    text,
  currency   text not null default 'EUR',
  timezone   text not null default 'UTC',
  updated_at timestamptz not null default now()
);

-- ─── 3. updated_at triggers (reuse public.set_updated_at — schema-agnostic) ──

create trigger set_expenses_updated_at
  before update on tenant_kaufnest.expenses
  for each row execute procedure public.set_updated_at();

create trigger set_purchases_updated_at
  before update on tenant_kaufnest.purchases
  for each row execute procedure public.set_updated_at();

create trigger set_sales_updated_at
  before update on tenant_kaufnest.sales
  for each row execute procedure public.set_updated_at();

create trigger set_products_updated_at
  before update on tenant_kaufnest.products
  for each row execute procedure public.set_updated_at();

-- ─── 4. Stock-sync triggers ─────────────────────────────────────
-- Same INSERT/UPDATE/DELETE-aware logic as public.apply_*_stock_change
-- (002_inventory_and_vat.sql), scoped to this tenant's products table.

create or replace function tenant_kaufnest.apply_purchase_stock_change()
returns trigger
language plpgsql
security definer
set search_path = tenant_kaufnest
as $$
begin
  if (TG_OP = 'INSERT') then
    if new.product_id is not null then
      update products set current_stock = current_stock + new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'UPDATE') then
    if old.product_id is not null then
      update products set current_stock = current_stock - old.quantity
        where id = old.product_id;
    end if;
    if new.product_id is not null then
      update products set current_stock = current_stock + new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    if old.product_id is not null then
      update products set current_stock = current_stock - old.quantity
        where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger purchases_stock_change
  after insert or update or delete on tenant_kaufnest.purchases
  for each row execute procedure tenant_kaufnest.apply_purchase_stock_change();

create or replace function tenant_kaufnest.apply_sale_stock_change()
returns trigger
language plpgsql
security definer
set search_path = tenant_kaufnest
as $$
begin
  if (TG_OP = 'INSERT') then
    if new.product_id is not null then
      update products set current_stock = current_stock - new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'UPDATE') then
    if old.product_id is not null then
      update products set current_stock = current_stock + old.quantity
        where id = old.product_id;
    end if;
    if new.product_id is not null then
      update products set current_stock = current_stock - new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    if old.product_id is not null then
      update products set current_stock = current_stock + old.quantity
        where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger sales_stock_change
  after insert or update or delete on tenant_kaufnest.sales
  for each row execute procedure tenant_kaufnest.apply_sale_stock_change();

-- ─── 5. Row-Level Security ───────────────────────────────────────
-- Two layers, mirroring 001/002 plus a tenant-membership check:
--   (a) is_tenant_member() — caller's JWT app_metadata.tenant_schema must
--       equal 'tenant_kaufnest'. This is the gap closer for
--       set_tenant_search_path, which only validates the 'tenant_' prefix,
--       not actual tenant membership — without this, an authenticated user
--       from a *different* tenant could call
--       set_tenant_search_path('tenant_kaufnest') directly via RPC and read
--       this schema's tables.
--   (b) the existing role-based rules (authenticated read/write, admin+ delete).

create or replace function tenant_kaufnest.is_tenant_member()
returns boolean
language sql stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_schema') = 'tenant_kaufnest',
    false
  );
$$;

create or replace function tenant_kaufnest.current_user_role()
returns text
language sql stable security definer
set search_path = tenant_kaufnest
as $$
  select role from tenant_kaufnest.profiles where id = auth.uid();
$$;

alter table tenant_kaufnest.profiles        enable row level security;
alter table tenant_kaufnest.expenses        enable row level security;
alter table tenant_kaufnest.purchases       enable row level security;
alter table tenant_kaufnest.sales           enable row level security;
alter table tenant_kaufnest.products        enable row level security;
alter table tenant_kaufnest.audit_logs      enable row level security;
alter table tenant_kaufnest.company_profile enable row level security;

-- profiles
create policy "profiles_select_self" on tenant_kaufnest.profiles
  for select using (tenant_kaufnest.is_tenant_member() and id = auth.uid());

create policy "profiles_select_admin" on tenant_kaufnest.profiles
  for select using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

create policy "profiles_update_self" on tenant_kaufnest.profiles
  for update using (tenant_kaufnest.is_tenant_member() and id = auth.uid())
  with check (tenant_kaufnest.is_tenant_member() and id = auth.uid());

create policy "profiles_manage_super_admin" on tenant_kaufnest.profiles
  for all using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() = 'super_admin');

-- expenses
create policy "expenses_select" on tenant_kaufnest.expenses
  for select using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "expenses_insert" on tenant_kaufnest.expenses
  for insert with check (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "expenses_update" on tenant_kaufnest.expenses
  for update using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "expenses_delete" on tenant_kaufnest.expenses
  for delete using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

-- purchases
create policy "purchases_select" on tenant_kaufnest.purchases
  for select using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "purchases_insert" on tenant_kaufnest.purchases
  for insert with check (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "purchases_update" on tenant_kaufnest.purchases
  for update using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "purchases_delete" on tenant_kaufnest.purchases
  for delete using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

-- sales
create policy "sales_select" on tenant_kaufnest.sales
  for select using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "sales_insert" on tenant_kaufnest.sales
  for insert with check (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "sales_update" on tenant_kaufnest.sales
  for update using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "sales_delete" on tenant_kaufnest.sales
  for delete using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

-- products
create policy "products_select" on tenant_kaufnest.products
  for select using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "products_insert" on tenant_kaufnest.products
  for insert with check (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "products_update" on tenant_kaufnest.products
  for update using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "products_delete" on tenant_kaufnest.products
  for delete using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

-- audit_logs
create policy "audit_logs_select" on tenant_kaufnest.audit_logs
  for select using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

create policy "audit_logs_insert" on tenant_kaufnest.audit_logs
  for insert with check (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

-- company_profile
create policy "company_profile_select" on tenant_kaufnest.company_profile
  for select using (tenant_kaufnest.is_tenant_member() and auth.role() = 'authenticated');

create policy "company_profile_update" on tenant_kaufnest.company_profile
  for update using (tenant_kaufnest.is_tenant_member() and tenant_kaufnest.current_user_role() in ('admin', 'super_admin'));

-- ─── 6. Indexes ───────────────────────────────────────────────────
create index idx_kaufnest_expenses_date       on tenant_kaufnest.expenses (date desc);
create index idx_kaufnest_expenses_created_by on tenant_kaufnest.expenses (created_by);
create index idx_kaufnest_purchases_date      on tenant_kaufnest.purchases (date desc);
create index idx_kaufnest_purchases_product   on tenant_kaufnest.purchases (product_id);
create index idx_kaufnest_sales_date          on tenant_kaufnest.sales (date desc);
create index idx_kaufnest_sales_platform      on tenant_kaufnest.sales (platform);
create index idx_kaufnest_sales_product       on tenant_kaufnest.sales (product_id);
create index idx_kaufnest_products_name       on tenant_kaufnest.products (name);
create index idx_kaufnest_audit_logs_user     on tenant_kaufnest.audit_logs (user_id);
create index idx_kaufnest_audit_logs_entity   on tenant_kaufnest.audit_logs (entity_type, entity_id);
create index idx_kaufnest_audit_logs_created  on tenant_kaufnest.audit_logs (created_at desc);

-- ─── 7. Migrate existing data from public.* ────────────────────────
-- Order matters for FK constraints: profiles -> products -> expenses/sales/purchases -> audit_logs.
-- Enum columns (role, currency, category, platform, action, entity_type) are
-- cast to text since tenant schema columns are plain text.

insert into tenant_kaufnest.profiles (id, email, full_name, role, created_at)
select id, email, full_name, role::text, created_at
from public.profiles;

insert into tenant_kaufnest.products (id, name, sku, current_stock, reorder_threshold, created_by, created_at, updated_at)
select id, name, sku, current_stock, reorder_threshold, created_by, created_at, updated_at
from public.products;

insert into tenant_kaufnest.expenses (id, title, amount, currency, category, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount)
select id, title, amount, currency::text, category::text, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount
from public.expenses;

insert into tenant_kaufnest.sales (id, platform, product_name, product_id, quantity, unit_price, total_amount, currency, date, description, created_by, created_at, updated_at, vat_rate, vat_amount)
select id, platform::text, product_name, product_id, quantity, unit_price, total_amount, currency::text, date, description, created_by, created_at, updated_at, vat_rate, vat_amount
from public.sales;

insert into tenant_kaufnest.purchases (id, product_name, product_id, quantity, unit_price, total_amount, currency, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount)
select id, product_name, product_id, quantity, unit_price, total_amount, currency::text, vendor, date, description, created_by, created_at, updated_at, vat_rate, vat_amount
from public.purchases;

insert into tenant_kaufnest.audit_logs (id, user_id, user_email, action, entity_type, entity_id, metadata, created_at)
select id, user_id, user_email, action::text, entity_type::text, entity_id, metadata, created_at
from public.audit_logs;

-- ─── 8. Seed company profile ─────────────────────────────────────
-- Edit name / vat_number / address afterwards via Settings → Company.
insert into tenant_kaufnest.company_profile (name, currency, timezone)
values ('KaufNest', 'EUR', 'UTC');

-- ─── 9. Stamp existing users with tenant_schema (Phase 2.3) ─────
-- Requires public.set_user_tenant from 003_saas_functions.sql.
select public.set_user_tenant(id, 'tenant_kaufnest') from auth.users;

-- ─── 10. Register tenant in control plane (run separately in PROJECT A) ──
-- insert into control.tenants (name, slug, schema_name, plan, status)
-- values ('KaufNest', 'kaufnest', 'tenant_kaufnest', 'business', 'active');
