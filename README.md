# KaufNest Dashboard

Multi-tenant SaaS bookkeeping dashboard for multi-platform product sales in
Germany. Each customer ("tenant") gets an isolated Postgres schema, role-based
access for their team, and optional eBay/Amazon integrations, dropshipping
tracking, and an eBay listing wizard — gated by subscription plan (Stripe).

## Architecture

Two Supabase projects:

- **Control plane** ("Project A") — tracks tenants (`control.tenants`) and
  KaufNest platform staff (`control.admin_users`). Never holds tenant
  business data.
- **Data plane** ("Project B") — one Postgres schema per tenant
  (`tenant_<slug>`), each with its own `sales`/`expenses`/`purchases`/
  `products`/`profiles`/etc. tables, RLS policies, and triggers. A single
  Supabase project hosts every tenant's schema.

`src/proxy.ts` (this Next.js version's middleware equivalent) resolves the
signed-in user's `tenant_schema` from their JWT `app_metadata` and enforces
route-level RBAC on every request. See `AGENTS.md` and `SAAS_MIGRATION.md`
for the full migration narrative and the rules that apply once you're working
in tenant-scoped code (never query `public.*`, never hardcode a schema name,
etc.).

## Stack

- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind CSS v4), Redux
  Toolkit for client state
- **Backend / Auth / DB**: Supabase (Postgres + built-in Auth), two projects
  as described above
- **Billing**: Stripe (source of truth for `plan`/`status` — see
  `src/lib/stripe.ts`)
- **Integrations**: eBay (OAuth + Trading/Inventory APIs), Amazon SP-API
- **Tests**: Jest + ts-jest (unit), Playwright (E2E)
- **Hosting**: Supabase Cloud + Vercel

## Features

- Login with email/password (Supabase Auth), per-tenant team invites
- Role-based access (`super_admin`, `admin`, `accountant`) plus additive
  per-user permission overrides (see the Users feature's Permissions modal)
- Sales/expenses/purchases tracking across Amazon, eBay, Etsy, Shopify, and
  more, with CSV import/export and PDF invoice generation
- Inventory with stock levels kept in sync via DB triggers
- Monthly overview: revenue, expenses, net profit, VAT position, per-platform
  balances
- Full audit log of user actions
- eBay/Amazon OAuth integrations with a manual order-review/import flow
- eBay listing creation wizard (Pro/Business plans)
- Dropshipping supplier-price tracking (KaufNest's own platform-admin tenant
  only, not a general tenant feature)
- Profit planner (client-side calculator, Pro/Business plans)
- Stripe-backed plan gating and billing
- KaufNest platform admin panel (`/admin`) — provision tenants, impersonate
  tenant admins, manage plan/status

## Local Development

This is a multi-tenant app — a fresh setup needs **both** Supabase projects,
not just one migration file.

1. Copy the env example and fill in your credentials (control plane +
   data plane Supabase projects, eBay/Amazon app credentials, a generated
   `TOKEN_ENCRYPTION_KEY`, etc.):
   ```bash
   cp .env.local.example .env.local
   ```
2. Follow `supabase/SKILL.md`'s "Apply order (for a fresh Project B, disaster
   recovery)" section to run the control-plane + data-plane migrations in the
   right order, and check that section's file map for which migrations are
   currently pending vs. applied on your own databases. `SAAS_MIGRATION.md`
   has the full narrative if you want the "why" behind each phase.
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000)

## Testing

```bash
npm test        # Jest unit tests
npm run test:e2e  # Playwright E2E (needs E2E_EMAIL/E2E_PASSWORD in .env.local)
```
