-- ============================================================
-- 028 — In-app notifications
--
-- One row per EVENT, not per user. Visibility is a property of the row and is
-- resolved per reader by RLS, so the client needs no permission logic at all —
-- a plain `select` returns exactly what the current user may see.
--
-- Rows are written ONLY by the triggers in the following migration (029),
-- which are SECURITY DEFINER and owned by the schema owner (owners bypass RLS).
-- There is deliberately NO insert policy for `authenticated` — users must never
-- be able to forge a notification.
--
-- NOTE: provision_tenant_schema() (005) has since been updated to also
-- create this schema for new tenants (Task 7 of the notifications feature) —
-- but 005 must be RE-APPLIED to Project B for that to take effect; until
-- then, newly provisioned tenants still get no notifications. See the
-- 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  create table if not exists {{schema}}.notifications (
    id                  uuid primary key default gen_random_uuid(),
    type                text not null,
    category            text not null,
    entity_type         text,
    entity_id           uuid,
    title               text not null,
    body                text,
    link                text,
    payload             jsonb,
    actor_id            uuid,
    visible_to_roles    text[] not null,
    required_permission text,
    created_at          timestamptz not null default now()
  );

  create table if not exists {{schema}}.notification_reads (
    notification_id uuid not null references {{schema}}.notifications(id) on delete cascade,
    user_id         uuid not null references {{schema}}.profiles(id)      on delete cascade,
    read_at         timestamptz not null default now(),
    primary key (notification_id, user_id)
  );

  alter table {{schema}}.profiles
    add column if not exists notifications_read_through timestamptz;

  create index if not exists idx_notifications_created
    on {{schema}}.notifications (created_at desc);
  create index if not exists idx_notifications_category
    on {{schema}}.notifications (category);
  create index if not exists idx_notification_reads_user
    on {{schema}}.notification_reads (user_id);

  alter table {{schema}}.notifications      enable row level security;
  alter table {{schema}}.notification_reads enable row level security;

  -- Read: tenant members see rows their role allows, plus rows unlocked by an
  -- additive per-user permission override.
  drop policy if exists "notifications_select" on {{schema}}.notifications;
  create policy "notifications_select" on {{schema}}.notifications for select using (
    {{schema}}.is_tenant_member()
    and ( {{schema}}.current_user_role() = any(visible_to_roles)
          or ( required_permission is not null
               and {{schema}}.current_user_has_override(required_permission) ) )
  );

  -- No insert/update/delete policy on notifications: only SECURITY DEFINER
  -- triggers write here.

  drop policy if exists "notification_reads_select" on {{schema}}.notification_reads;
  create policy "notification_reads_select" on {{schema}}.notification_reads for select using (
    {{schema}}.is_tenant_member() and user_id = auth.uid()
  );

  drop policy if exists "notification_reads_insert" on {{schema}}.notification_reads;
  create policy "notification_reads_insert" on {{schema}}.notification_reads for insert with check (
    {{schema}}.is_tenant_member() and user_id = auth.uid()
  );

  drop policy if exists "notification_reads_delete" on {{schema}}.notification_reads;
  create policy "notification_reads_delete" on {{schema}}.notification_reads for delete using (
    {{schema}}.is_tenant_member() and user_id = auth.uid()
  );

  -- Grants: CREATE SCHEMA grants nothing by default. Without these, PostgREST
  -- fails with 42501 BEFORE RLS is even evaluated.
  grant select on {{schema}}.notifications to authenticated;
  grant select, insert, delete on {{schema}}.notification_reads to authenticated;

  -- Revoke default privileges inherited from ALTER DEFAULT PRIVILEGES: this table
  -- must never allow insert/update/delete even if default privileges grant them.
  -- RLS alone is insufficient; privileges must match intent.
  revoke insert, update, delete on {{schema}}.notifications from authenticated, anon;
$$);
