-- supabase/control-plane/011_bug_reports.sql
-- ============================================================
-- In-app support / bug tracker.
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Reports live here, not in tenant schemas: support is a cross-tenant vendor
-- inbox, and the Trello webhook arrives with no tenant JWT to resolve. Tenant
-- users never read these tables directly — /api/support/reports filters by the
-- caller's tenant_id server-side (control tables are unreachable from the
-- browser by design).
-- ============================================================

create table if not exists control.bug_reports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references control.tenants(id) on delete cascade,
  -- Project B auth user id. Deliberately no FK: auth lives in a different
  -- database, so cross-project referential integrity is unavailable.
  reporter_user_id uuid not null,
  reporter_email   text not null,
  type             text not null check (type in ('bug','feature','question')),
  severity         text not null check (severity in ('low','normal','high','critical')),
  title            text not null,
  description      text not null,
  status           text not null default 'reported'
                     check (status in ('reported','in_progress','fixed','wont_fix')),
  page_url         text,
  context          jsonb,
  -- [{ id, name, mime, bytes }] — Trello attachment metadata only. The bytes
  -- live on Trello; we never store the file.
  attachments      jsonb not null default '[]'::jsonb,
  trello_card_id   text,
  trello_card_url  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_synced_at   timestamptz
);

create table if not exists control.bug_report_replies (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references control.bug_reports(id) on delete cascade,
  body              text not null,
  author            text,
  -- Idempotency key: Trello redelivers webhook actions, and a replay must not
  -- duplicate a reply.
  trello_comment_id text unique,
  created_at        timestamptz not null default now()
);

create index if not exists idx_bug_reports_tenant
  on control.bug_reports (tenant_id, created_at desc);
create index if not exists idx_bug_reports_status
  on control.bug_reports (status);
create index if not exists idx_bug_reports_card
  on control.bug_reports (trello_card_id);
create index if not exists idx_bug_report_replies_report
  on control.bug_report_replies (report_id, created_at);

-- Service-role key bypasses RLS; this blocks anon/authenticated by default,
-- matching control.tenants and control.tenant_ai_usage.
alter table control.bug_reports        enable row level security;
alter table control.bug_report_replies enable row level security;
