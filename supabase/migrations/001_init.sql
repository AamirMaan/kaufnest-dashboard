-- ============================================================
-- KaufNest Dashboard — Initial Schema
-- Run this in your Supabase SQL editor or via Supabase CLI
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Types ───────────────────────────────────────────────────
create type user_role as enum ('super_admin', 'admin', 'accountant');
create type currency_code as enum ('EUR', 'USD', 'GBP');
create type expense_category as enum (
  'shipping', 'advertising', 'software', 'office',
  'inventory', 'tax', 'salary', 'other'
);
create type platform as enum ('amazon', 'ebay', 'etsy', 'shopify', 'other');
create type audit_action as enum ('create', 'update', 'delete', 'login', 'logout', 'role_change');
create type audit_entity as enum ('expense', 'purchase', 'sale', 'user');

-- ─── Profiles ────────────────────────────────────────────────
-- Extends auth.users with role & display name
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        user_role not null default 'accountant',
  created_at  timestamptz not null default now()
);

-- Auto-create a profile on sign-up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Expenses ─────────────────────────────────────────────────
create table public.expenses (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  currency    currency_code not null default 'EUR',
  category    expense_category not null,
  vendor      text,
  date        date not null,
  description text,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── Purchases ────────────────────────────────────────────────
create table public.purchases (
  id           uuid primary key default uuid_generate_v4(),
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  total_amount numeric(12,2) generated always as (quantity * unit_price) stored,
  currency     currency_code not null default 'EUR',
  vendor       text,
  date         date not null,
  description  text,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── Sales ────────────────────────────────────────────────────
create table public.sales (
  id           uuid primary key default uuid_generate_v4(),
  platform     platform not null,
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  total_amount numeric(12,2) generated always as (quantity * unit_price) stored,
  currency     currency_code not null default 'EUR',
  date         date not null,
  description  text,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── Audit Logs ───────────────────────────────────────────────
create table public.audit_logs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles (id) on delete set null,
  user_email  text,
  action      audit_action not null,
  entity_type audit_entity not null,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

-- ─── Updated-at Trigger ───────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_expenses_updated_at
  before update on public.expenses
  for each row execute procedure public.set_updated_at();

create trigger set_purchases_updated_at
  before update on public.purchases
  for each row execute procedure public.set_updated_at();

create trigger set_sales_updated_at
  before update on public.sales
  for each row execute procedure public.set_updated_at();

-- ─── Row-Level Security ───────────────────────────────────────
alter table public.profiles    enable row level security;
alter table public.expenses    enable row level security;
alter table public.purchases   enable row level security;
alter table public.sales       enable row level security;
alter table public.audit_logs  enable row level security;

-- Helper: get current user's role
create or replace function public.current_user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Profiles: users see their own row; admins/super_admin see all
create policy "profiles_select_self" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_select_admin" on public.profiles
  for select using (current_user_role() in ('admin', 'super_admin'));

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_manage_super_admin" on public.profiles
  for all using (current_user_role() = 'super_admin');

-- Expenses: all authenticated users can read; accountants can insert; admin+ can delete
create policy "expenses_select" on public.expenses
  for select using (auth.role() = 'authenticated');

create policy "expenses_insert" on public.expenses
  for insert with check (auth.role() = 'authenticated');

create policy "expenses_update" on public.expenses
  for update using (auth.role() = 'authenticated');

create policy "expenses_delete" on public.expenses
  for delete using (current_user_role() in ('admin', 'super_admin'));

-- Purchases: same pattern
create policy "purchases_select" on public.purchases
  for select using (auth.role() = 'authenticated');

create policy "purchases_insert" on public.purchases
  for insert with check (auth.role() = 'authenticated');

create policy "purchases_update" on public.purchases
  for update using (auth.role() = 'authenticated');

create policy "purchases_delete" on public.purchases
  for delete using (current_user_role() in ('admin', 'super_admin'));

-- Sales: same pattern
create policy "sales_select" on public.sales
  for select using (auth.role() = 'authenticated');

create policy "sales_insert" on public.sales
  for insert with check (auth.role() = 'authenticated');

create policy "sales_update" on public.sales
  for update using (auth.role() = 'authenticated');

create policy "sales_delete" on public.sales
  for delete using (current_user_role() in ('admin', 'super_admin'));

-- Audit logs: only admin+ can read; system writes them
create policy "audit_logs_select" on public.audit_logs
  for select using (current_user_role() in ('admin', 'super_admin'));

create policy "audit_logs_insert" on public.audit_logs
  for insert with check (auth.role() = 'authenticated');

-- ─── Indexes ──────────────────────────────────────────────────
create index idx_expenses_date       on public.expenses (date desc);
create index idx_expenses_created_by on public.expenses (created_by);
create index idx_purchases_date      on public.purchases (date desc);
create index idx_sales_date          on public.sales (date desc);
create index idx_sales_platform      on public.sales (platform);
create index idx_audit_logs_user     on public.audit_logs (user_id);
create index idx_audit_logs_entity   on public.audit_logs (entity_type, entity_id);
create index idx_audit_logs_created  on public.audit_logs (created_at desc);
