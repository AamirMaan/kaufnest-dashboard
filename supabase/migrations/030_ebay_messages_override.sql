-- ============================================================
-- 030 — Give the manage_messages override a working RLS branch
--
-- REQUIRES 027 (creates `ebay_messages` and `ebay_messages_all_admin` in
-- every tenant schema) to be applied first.
--
-- THE DEAD-END CLICK THIS FIXES: migration 029's notify_message_received
-- inserts the `message.received` notification row with
-- required_permission = 'manage_messages', so the notifications_select
-- policy (028) correctly lets a non-admin user who has been granted the
-- `manage_messages` permission override see the bell entry. But
-- `ebay_messages_all_admin` (026/027) was role-only
-- (admin/super_admin, no override branch at all) — that same user could
-- click the notification, land on /dashboard/messages, and its RLS-backed
-- fetch would return nothing for their role. The notification promised
-- access the underlying table never granted.
--
-- This redefines `ebay_messages_all_admin` in every tenant schema to add
-- the override branch to BOTH `using` and `with check`, so a user granted
-- `manage_messages` can now actually read/reply-to eBay messages, not just
-- see that one arrived. `is_tenant_member()` and everything else about the
-- policy is unchanged. Idempotent via `drop policy if exists`.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  drop policy if exists "ebay_messages_all_admin" on {{schema}}.ebay_messages;
  create policy "ebay_messages_all_admin" on {{schema}}.ebay_messages
    for all
    using (
      {{schema}}.is_tenant_member()
      and ({{schema}}.current_user_role() in ('admin', 'super_admin')
           or {{schema}}.current_user_has_override('manage_messages'))
    )
    with check (
      {{schema}}.is_tenant_member()
      and ({{schema}}.current_user_role() in ('admin', 'super_admin')
           or {{schema}}.current_user_has_override('manage_messages'))
    );
$$);
