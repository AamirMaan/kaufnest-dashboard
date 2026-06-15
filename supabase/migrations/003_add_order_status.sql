-- ============================================================
-- Order status + return handling (public schema)
-- ✅ Already applied — kept here for reproducibility / disaster recovery,
-- same convention as 001_init.sql / 002_inventory_and_vat.sql.
--
-- Renumbered from the original 007_add_order_status.sql, trimmed to the
-- public.sales portion only — the tenant_kaufnest.sales equivalent of this
-- change (status/restock columns + the same return-aware stock trigger) was
-- applied at the same time, as part of provisioning tenant_kaufnest (see
-- 006_bootstrap_tenant_kaufnest.sql) and is now baked into
-- provision_tenant_schema() for all future tenants (005_tenant_provisioning.sql).
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
-- The stock-sync trigger function is rewritten to compute a per-row stock
-- delta instead of always applying -quantity:
--   delta(row) = (row.status = 'returned' and row.restock) ? 0 : -quantity
-- INSERT applies +delta(new); UPDATE reverses delta(old) then applies
-- delta(new); DELETE reverses delta(old) — same insert/update/delete-aware
-- shape as before, just driven by `delta` instead of a hardcoded quantity.
-- ============================================================

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
