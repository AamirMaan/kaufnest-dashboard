-- supabase/control-plane/008_ai_usage_atomic_increment.sql
-- ============================================================
-- Atomic AI-usage increment.
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- 007 created control.tenant_ai_usage; the app incremented it with a
-- read-then-upsert from `recordUsage()` (src/lib/ai/quota.ts). That is two
-- round-trips with no lock between them, so N concurrent AI calls all read
-- the same `calls` value and all write `calls + 1` — N-1 increments are lost.
-- A double-clicked button or the same form open in two tabs is enough: the
-- tenant is billed for every Anthropic call but the meter only ever moves by
-- one, which defeats the quota the whole subsystem exists to enforce.
--
-- A single INSERT ... ON CONFLICT DO UPDATE is atomic under Postgres's
-- row-locking semantics: the conflicting row is locked for the duration of
-- the statement, so `tenant_ai_usage.calls + 1` is evaluated against the
-- committed value each time and concurrent callers serialise instead of
-- clobbering each other.
--
-- SECURITY DEFINER + a pinned empty search_path: the function is only ever
-- called by the service-role key today (which bypasses RLS regardless), but
-- definer rights mean a future least-privilege caller can meter usage
-- without being granted write access to the whole table.
-- ============================================================

create or replace function control.record_ai_usage(
  p_tenant uuid,
  p_user   uuid,
  p_period date,
  p_kind   text,
  p_in     bigint,
  p_out    bigint
) returns integer
language sql
security definer
set search_path = ''
as $$
  insert into control.tenant_ai_usage
    (tenant_id, user_id, period, kind, calls, input_tokens, output_tokens, updated_at)
  values
    (p_tenant, p_user, p_period, p_kind, 1, p_in, p_out, now())
  on conflict (tenant_id, user_id, period, kind) do update set
    -- Unqualified here on purpose: inside ON CONFLICT DO UPDATE this is the
    -- statement's range-table alias for the insert target, not a name looked
    -- up through search_path (which is pinned empty above).
    calls         = tenant_ai_usage.calls + 1,
    input_tokens  = tenant_ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = tenant_ai_usage.output_tokens + excluded.output_tokens,
    updated_at    = now()
  returning calls;
$$;

-- Matches 002_grants.sql / 004_admin_audit_log.sql: service_role is the only
-- identity that ever reaches the control plane.
grant execute on function control.record_ai_usage(uuid, uuid, date, text, bigint, bigint)
  to service_role;
