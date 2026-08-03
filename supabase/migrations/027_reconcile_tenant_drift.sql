-- ============================================================
-- 027 — Reconcile tenant schema drift (2026-08-03)
--
-- This repository has no migration ledger. A live audit via Supabase MCP on
-- 2026-08-03 found every tenant schema missing a DIFFERENT set of migrations:
--
--   ebay_messages (026)                     — missing in ALL 5 tenants
--   profiles.permission_overrides (023)     — missing in tenant_testing
--   current_user_has_override() (023)       — missing in tenant_testing
--   sales fee columns (010)                 — missing in tenant_testing
--   purchases.sale_id (015)                 — missing in tenant_hochkauf
--
-- Root cause for the 010 gap: that migration hardcoded `tenant_kaufnest`
-- instead of using run_on_all_tenant_schemas. Fixed in the same branch.
--
-- Every statement below is idempotent — re-running is safe and is the
-- intended way to bring a lagging tenant up to date.
--
-- NOTE: dropship_listings is missing from 4 of 5 tenants. That is deliberately
-- NOT reconciled here — it is unrelated to notifications and belongs to the
-- dropshipping feature. Tracked separately.
-- ============================================================

-- ── 010: order fee columns on sales ─────────────────────────
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists shipping_cost    numeric(12,2) check (shipping_cost    >= 0),
    add column if not exists shipping_charged numeric(12,2) check (shipping_charged >= 0),
    add column if not exists advertising_fee  numeric(12,2) check (advertising_fee  >= 0);
$$);

-- ── 015: purchases.sale_id + its indexes ────────────────────
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.purchases
    add column if not exists sale_id uuid
      references {{schema}}.sales(id) on delete set null;
$$);

select public.run_on_all_tenant_schemas($$
  create index if not exists idx_purchases_sale_id
    on {{schema}}.purchases (sale_id);
$$);

select public.run_on_all_tenant_schemas($$
  create unique index if not exists idx_purchases_sale_id_unique
    on {{schema}}.purchases (sale_id)
    where sale_id is not null;
$$);

-- ── 023: permission overrides column + helper function ──────
select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.profiles
    add column if not exists permission_overrides jsonb not null default '[]'::jsonb;

  create or replace function {{schema}}.current_user_has_override(perm text)
  returns boolean
  language sql stable security definer
  set search_path = {{schema}}
  as $func$
    select coalesce(
      (select permission_overrides from profiles where id = auth.uid()) ? perm,
      false
    );
  $func$;

  drop policy if exists "expenses_delete" on {{schema}}.expenses;
  create policy "expenses_delete" on {{schema}}.expenses for delete using (
    {{schema}}.is_tenant_member()
    and ({{schema}}.current_user_role() in ('admin', 'super_admin')
         or {{schema}}.current_user_has_override('delete_expense'))
  );

  drop policy if exists "purchases_delete" on {{schema}}.purchases;
  create policy "purchases_delete" on {{schema}}.purchases for delete using (
    {{schema}}.is_tenant_member()
    and ({{schema}}.current_user_role() in ('admin', 'super_admin')
         or {{schema}}.current_user_has_override('delete_purchase'))
  );

  drop policy if exists "sales_delete" on {{schema}}.sales;
  create policy "sales_delete" on {{schema}}.sales for delete using (
    {{schema}}.is_tenant_member()
    and ({{schema}}.current_user_role() in ('admin', 'super_admin')
         or {{schema}}.current_user_has_override('delete_sale'))
  );
$$);

-- ── 026: ebay_messages table ────────────────────────────────
select public.run_on_all_tenant_schemas($$
  create table if not exists {{schema}}.ebay_messages (
    id                   uuid primary key default gen_random_uuid(),
    external_message_id  text,
    item_id              text not null,
    buyer_username       text not null,
    direction            text not null check (direction in ('inbound', 'outbound')),
    subject              text,
    body                 text not null,
    question_type        text,
    is_read              boolean not null default false,
    ebay_created_at      timestamptz not null,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
  );

  create or replace trigger set_ebay_messages_updated_at
    before update on {{schema}}.ebay_messages
    for each row execute procedure public.set_updated_at();

  create unique index if not exists idx_ebay_messages_external_id
    on {{schema}}.ebay_messages (external_message_id)
    where external_message_id is not null;
  create index if not exists idx_ebay_messages_thread
    on {{schema}}.ebay_messages (buyer_username, item_id, ebay_created_at);

  alter table {{schema}}.ebay_messages enable row level security;

  drop policy if exists "ebay_messages_all_admin" on {{schema}}.ebay_messages;
  create policy "ebay_messages_all_admin" on {{schema}}.ebay_messages
    for all
    using ({{schema}}.is_tenant_member() and {{schema}}.current_user_role() in ('admin', 'super_admin'))
    with check ({{schema}}.is_tenant_member() and {{schema}}.current_user_role() in ('admin', 'super_admin'));

  grant select, insert, update, delete on {{schema}}.ebay_messages to authenticated;
$$);
