-- ============================================================
-- Order status + return handling
-- Run this in the Supabase SQL editor for both Project A/B schemas that
-- still have a `sales` table (public + tenant_kaufnest — mirrors the
-- 002 -> 004 pattern of altering both in lockstep).
--
-- Adds:
--   - sales.status   text    — free-form ("pending", "delivered",
--     "returned", or any custom string entered via "Other" in the UI).
--   - sales.restock  boolean — only meaningful when status = 'returned'.
--     true  => the returned item is resellable, so its stock should go
--              back to `products.current_stock` (net stock effect of the
--              sale becomes 0, as if it never left).
--     false => the item is written off (damaged/unsellable); stock stays
--              decremented as it was for a normal sale.
--
-- The stock-sync trigger functions are rewritten to compute a per-row
-- stock delta instead of always applying -quantity:
--   delta(row) = (row.status = 'returned' and row.restock) ? 0 : -quantity
-- INSERT applies +delta(new); UPDATE reverses delta(old) then applies
-- delta(new); DELETE reverses delta(old) — same insert/update/delete-aware
-- shape as before, just driven by `delta` instead of a hardcoded quantity.
-- ============================================================

-- ─── public.sales ───────────────────────────────────────────
alter table public.sales add column if not exists status  text not null default 'pending';
alter table public.sales add column if not exists restock boolean not null default false;

create index if not exists idx_sales_status on public.sales (status);

create or replace function public.apply_sale_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_delta integer;
  new_delta integer;
begin
  if (TG_OP = 'INSERT') then
    if new.product_id is not null then
      new_delta := case when new.status = 'returned' and new.restock then 0 else -new.quantity end;
      update public.products set current_stock = current_stock + new_delta
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'UPDATE') then
    if old.product_id is not null then
      old_delta := case when old.status = 'returned' and old.restock then 0 else -old.quantity end;
      update public.products set current_stock = current_stock - old_delta
        where id = old.product_id;
    end if;
    if new.product_id is not null then
      new_delta := case when new.status = 'returned' and new.restock then 0 else -new.quantity end;
      update public.products set current_stock = current_stock + new_delta
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    if old.product_id is not null then
      old_delta := case when old.status = 'returned' and old.restock then 0 else -old.quantity end;
      update public.products set current_stock = current_stock - old_delta
        where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

-- ─── tenant_kaufnest.sales ──────────────────────────────────
alter table tenant_kaufnest.sales add column if not exists status  text not null default 'pending';
alter table tenant_kaufnest.sales add column if not exists restock boolean not null default false;

create index if not exists idx_kaufnest_sales_status on tenant_kaufnest.sales (status);

create or replace function tenant_kaufnest.apply_sale_stock_change()
returns trigger
language plpgsql
security definer
set search_path = tenant_kaufnest
as $$
declare
  old_delta integer;
  new_delta integer;
begin
  if (TG_OP = 'INSERT') then
    if new.product_id is not null then
      new_delta := case when new.status = 'returned' and new.restock then 0 else -new.quantity end;
      update products set current_stock = current_stock + new_delta
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'UPDATE') then
    if old.product_id is not null then
      old_delta := case when old.status = 'returned' and old.restock then 0 else -old.quantity end;
      update products set current_stock = current_stock - old_delta
        where id = old.product_id;
    end if;
    if new.product_id is not null then
      new_delta := case when new.status = 'returned' and new.restock then 0 else -new.quantity end;
      update products set current_stock = current_stock + new_delta
        where id = new.product_id;
    end if;
    return new;
  elsif (TG_OP = 'DELETE') then
    if old.product_id is not null then
      old_delta := case when old.status = 'returned' and old.restock then 0 else -old.quantity end;
      update products set current_stock = current_stock - old_delta
        where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;
