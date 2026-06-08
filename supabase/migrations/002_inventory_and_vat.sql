-- ============================================================
-- KaufNest Dashboard — Inventory + VAT
-- Run this in your Supabase SQL editor or via Supabase CLI
-- ============================================================

-- ─── Audit entity: products are now an auditable entity ──────
alter type audit_entity add value if not exists 'product';

-- ─── Products (Inventory) ─────────────────────────────────────
create table public.products (
  id                 uuid primary key default uuid_generate_v4(),
  name               text not null unique,
  sku                text,
  current_stock      integer not null default 0,
  reorder_threshold  integer,
  created_by         uuid not null references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_products_updated_at
  before update on public.products
  for each row execute procedure public.set_updated_at();

-- ─── Link purchases/sales to products (optional — nullable) ──
alter table public.purchases
  add column product_id uuid references public.products (id) on delete set null;

alter table public.sales
  add column product_id uuid references public.products (id) on delete set null;

-- ─── VAT columns ──────────────────────────────────────────────
-- Both null = no VAT recorded for that record (e.g. reverse-charge/non-EU).
-- vat_amount is the VAT portion *within* the existing total_amount/amount
-- (which stays the gross/paid figure) — not an addition on top of it.
alter table public.expenses  add column vat_rate   numeric(5,2);
alter table public.expenses  add column vat_amount numeric(12,2);
alter table public.purchases add column vat_rate   numeric(5,2);
alter table public.purchases add column vat_amount numeric(12,2);
alter table public.sales     add column vat_rate   numeric(5,2);
alter table public.sales     add column vat_amount numeric(12,2);

-- ─── Stock-sync triggers ──────────────────────────────────────
-- Purchases increase stock, sales decrease it. Each function reverses the
-- OLD row's effect and applies the NEW row's effect, which correctly
-- handles inserts, quantity edits, re-linking to a different product, and
-- deletes in a single code path. security definer + search_path mirrors
-- handle_new_user/set_updated_at so the update to `products` runs regardless
-- of the acting user's RLS grants on that table.

create or replace function public.apply_purchase_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT') then
    if new.product_id is not null then
      update public.products set current_stock = current_stock + new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'UPDATE') then
    if old.product_id is not null then
      update public.products set current_stock = current_stock - old.quantity
        where id = old.product_id;
    end if;
    if new.product_id is not null then
      update public.products set current_stock = current_stock + new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    if old.product_id is not null then
      update public.products set current_stock = current_stock - old.quantity
        where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger purchases_stock_change
  after insert or update or delete on public.purchases
  for each row execute procedure public.apply_purchase_stock_change();

create or replace function public.apply_sale_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT') then
    if new.product_id is not null then
      update public.products set current_stock = current_stock - new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'UPDATE') then
    if old.product_id is not null then
      update public.products set current_stock = current_stock + old.quantity
        where id = old.product_id;
    end if;
    if new.product_id is not null then
      update public.products set current_stock = current_stock - new.quantity
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    if old.product_id is not null then
      update public.products set current_stock = current_stock + old.quantity
        where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger sales_stock_change
  after insert or update or delete on public.sales
  for each row execute procedure public.apply_sale_stock_change();

-- ─── Row-Level Security ───────────────────────────────────────
alter table public.products enable row level security;

-- Products: same pattern as purchases/sales — all authenticated users can
-- read/insert/update; only admin+ can delete.
create policy "products_select" on public.products
  for select using (auth.role() = 'authenticated');

create policy "products_insert" on public.products
  for insert with check (auth.role() = 'authenticated');

create policy "products_update" on public.products
  for update using (auth.role() = 'authenticated');

create policy "products_delete" on public.products
  for delete using (current_user_role() in ('admin', 'super_admin'));

-- ─── Indexes ──────────────────────────────────────────────────
create index idx_products_name      on public.products (name);
create index idx_purchases_product  on public.purchases (product_id);
create index idx_sales_product      on public.sales (product_id);
