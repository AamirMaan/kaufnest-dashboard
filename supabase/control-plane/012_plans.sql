-- ============================================================
-- Plan catalog — control plane (Project A, kaufnest-control)
-- Run in the Supabase SQL editor for PROJECT A.
--
-- Replaces the hardcoded plan matrix (src/lib/utils/planGating.ts,
-- src/lib/utils/pricing.ts, STRIPE_PRICE_* env vars, TRIAL_DAYS = 14).
-- Managed from /admin/plans. See
-- docs/superpowers/specs/2026-10-03-plan-management-design.md.
--
-- After applying: run `npm run plans:seed-stripe` once per environment to
-- copy the existing Stripe price/product IDs into the seeded rows. Until
-- then checkout/change-plan answer "Plan not available" (gating already
-- works from the seeded rows).
-- ============================================================

create table if not exists control.plans (
  key                      text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  kind                     text not null check (kind in ('trial', 'paid')),
  name                     text not null check (length(btrim(name)) > 0),
  tagline                  text not null default '',
  visibility               text not null check (visibility in ('public', 'hidden', 'retired')),
  monthly_eur              numeric(10,2),
  stripe_product_id        text,
  stripe_price_id          text unique,
  max_users                integer check (max_users is null or max_users >= 1),
  platform_integrations    boolean not null default false,
  ai_features              boolean not null default false,
  ai_generations_per_month integer not null default 0 check (ai_generations_per_month >= 0),
  messaging_and_listings   boolean not null default false,
  advanced_inventory       boolean not null default false,
  trial_days               integer,
  sort_order               integer not null default 0,
  highlighted              boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- The trial row's key is fixed: isTrialExpired() compares plan === 'trial'.
  constraint plans_trial_key check ((kind = 'trial') = (key = 'trial')),
  constraint plans_ai_quota_needs_ai check (ai_features or ai_generations_per_month = 0),
  constraint plans_kind_shape check (
    (kind = 'paid'
      and monthly_eur is not null and monthly_eur >= 1
      and trial_days is null)
    or
    (kind = 'trial'
      and monthly_eur is null and stripe_price_id is null and stripe_product_id is null
      and visibility = 'hidden'
      and trial_days between 1 and 90)
  )
);

-- Every Stripe price a plan has ever had. Grandfathered subscriptions stay
-- on an old price; the webhook resolves it back to its plan through here.
create table if not exists control.plan_prices (
  stripe_price_id text primary key,
  plan_key        text not null references control.plans(key),
  monthly_eur     numeric(10,2) not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_plan_prices_plan_key on control.plan_prices (plan_key);

alter table control.plans enable row level security;
alter table control.plan_prices enable row level security;

-- All access goes through the server-side control client (service role),
-- same pattern as 004_admin_audit_log.sql. No delete: plans are retired.
grant select, insert, update on control.plans to service_role;
grant select, insert on control.plan_prices to service_role;

insert into control.plans
  (key, kind, name, tagline, visibility, monthly_eur, max_users,
   platform_integrations, ai_features, ai_generations_per_month,
   messaging_and_listings, advanced_inventory, trial_days, sort_order, highlighted)
values
  ('trial',    'trial', 'Trial',    '',
     'hidden', null, null, true,  true,  300, true,  true,  14,   0, false),
  ('starter',  'paid',  'Starter',  'Bookkeeping for a small team, entered by hand.',
     'public', 20,   3,    false, false, 0,   false, false, null, 1, false),
  ('pro',      'paid',  'Pro',      'Pull your eBay and Amazon orders in automatically.',
     'public', 30,   5,    true,  false, 0,   false, false, null, 2, true),
  ('business', 'paid',  'Business', 'Run listings, messages and the whole operation in one place.',
     'public', 50,   null, true,  true,  300, true,  true,  null, 3, false)
on conflict (key) do nothing;
