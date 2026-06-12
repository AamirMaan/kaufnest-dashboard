# KaufNest — Multi-Tenant SaaS Migration

Step-by-step instructions for converting KaufNest from a single-tenant internal
tool into a multi-tenant SaaS product. Each phase is independently shippable.
Complete phases in order — later phases depend on earlier ones.

---

## Architecture summary

Two Supabase projects:

- **Project A — Control Plane**: tenant registry, admin users, Stripe mapping.
  Only your KaufNest admin app touches this.
- **Project B — Data Plane**: one PostgreSQL schema per tenant
  (`tenant_<slug>`). All existing tables (sales, expenses, purchases, etc.) move
  into these schemas. The public schema holds nothing after migration.

Auth flow: Supabase Auth (Project B) issues a JWT → Next.js middleware reads
`tenant_schema` from JWT app_metadata → sets `search_path` on every DB
connection → queries automatically hit the right schema.

---

## Phase 1 — Control Plane (new Supabase project)

**Goal**: Create the registry that tracks every tenant, their schema name, plan,
and Stripe subscription.

### Step 1.1 — Create Supabase Project A

In the Supabase dashboard create a second project. Call it `kaufnest-control`.
Save its URL and service-role key — you will need them in Step 1.3.

### Step 1.2 — Add environment variables

Add to `.env.local` (never commit this file):

```
# Control Plane (Project A)
CONTROL_SUPABASE_URL=https://<project-a-ref>.supabase.co
CONTROL_SUPABASE_SERVICE_KEY=<project-a-service-role-key>

# Data Plane (Project B — existing project)
NEXT_PUBLIC_SUPABASE_URL=https://<project-b-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<project-b-anon-key>
# Already present in .env.local from before the SaaS migration — reused as-is,
# all Project B service-role clients (createServiceClientForTenant,
# provision-tenant, impersonate) read this same var.
SUPABASE_SERVICE_ROLE_KEY=<project-b-service-role-key>

# Stripe (added in Phase 4)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

Also add these keys to Vercel / your deployment environment. Never use the
service-role key in client-side code (`NEXT_PUBLIC_*`).

### Step 1.3 — Create control plane Supabase client

Create `src/lib/supabase/control.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client for the control plane (Project A).
 * Never import this in Client Components or expose it to the browser.
 */
export function createControlClient() {
  return createClient(
    process.env.CONTROL_SUPABASE_URL!,
    process.env.CONTROL_SUPABASE_SERVICE_KEY!
  );
}
```

### Step 1.4 — Run control plane migration

Run `supabase/control-plane/001_schema.sql` in the Supabase SQL editor for
**Project A**. ✅ Already applied.

No policies are needed on these tables — `createControlClient()` (Step 1.3) always
uses the service-role key, which bypasses RLS. RLS is enabled purely so anon/
authenticated keys are denied by default if ever pointed at this schema.

### Step 1.5 — Add Tenant type

Add to `src/types/index.ts`:

```ts
// ─── SaaS / Multi-Tenant ──────────────────────────────────────────────────────

export type TenantPlan = "trial" | "starter" | "pro" | "business";
export type TenantStatus = "active" | "inactive" | "cancelled";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Phase 2 — Schema-per-tenant isolation (Data Plane)

**Goal**: Move all existing tables out of the `public` schema into a per-tenant
schema. The existing data (your own company) becomes the first tenant.

### Step 2.1 — Create the base migration SQL template

Create `supabase/tenant-schema-template.sql`. This file is the canonical
definition of a tenant schema — every new tenant gets exactly this structure.

```sql
-- Run with search_path already set to the target schema, e.g.:
--   SET search_path TO tenant_acme;
-- OR pass the schema name as a parameter and prefix every table.

CREATE TABLE profiles (
  id         uuid PRIMARY KEY,               -- matches auth.users.id
  email      text NOT NULL,
  full_name  text NOT NULL DEFAULT '',
  role       text NOT NULL DEFAULT 'accountant'
               CHECK (role IN ('super_admin', 'admin', 'accountant')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  amount      numeric(12,2) NOT NULL,
  currency    text NOT NULL DEFAULT 'EUR',
  category    text NOT NULL,
  vendor      text,
  date        date NOT NULL,
  description text,
  created_by  uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  vat_rate    numeric(5,2),
  vat_amount  numeric(12,2)
);

CREATE TABLE sales (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     text NOT NULL,
  product_name text NOT NULL,
  product_id   uuid,
  quantity     integer NOT NULL DEFAULT 1,
  unit_price   numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  currency     text NOT NULL DEFAULT 'EUR',
  date         date NOT NULL,
  description  text,
  created_by   uuid NOT NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  vat_rate     numeric(5,2),
  vat_amount   numeric(12,2)
);

CREATE TABLE purchases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  product_id   uuid,
  quantity     integer NOT NULL DEFAULT 1,
  unit_price   numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  currency     text NOT NULL DEFAULT 'EUR',
  vendor       text,
  date         date NOT NULL,
  description  text,
  created_by   uuid NOT NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  vat_rate     numeric(5,2),
  vat_amount   numeric(12,2)
);

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  sku               text,
  current_stock     integer NOT NULL DEFAULT 0,
  reorder_threshold integer,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  user_email  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_profile (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  logo_url     text,
  vat_number   text,
  address      text,
  currency     text NOT NULL DEFAULT 'EUR',
  timezone     text NOT NULL DEFAULT 'UTC',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Stock trigger (same as existing migration 002)
CREATE OR REPLACE FUNCTION update_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE products SET current_stock = current_stock - NEW.quantity
    WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_stock_change
  AFTER INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION update_stock_on_sale();
```

### Step 2.2 — Migrate your own data into tenant_kaufnest schema

Run `supabase/migrations/003_saas_functions.sql` in **Project B** first (if you
haven't already) — it defines `public.set_user_tenant`, used in step 9 below.

Then run `supabase/migrations/004_phase2_tenant_kaufnest.sql` in **Project B**.
It does everything in one pass:

1. Creates the `tenant_kaufnest` schema with all tables (mirrors
   `tenant-schema-template.sql`, plus the full INSERT/UPDATE/DELETE-aware stock
   triggers from `002_inventory_and_vat.sql`)
2. Enables RLS with tenant-membership + role-based policies
3. Copies existing `public.*` data into `tenant_kaufnest.*` (casting enum
   columns to `text`)
4. Seeds `tenant_kaufnest.company_profile`
5. Stamps every existing `auth.users` row with `tenant_schema='tenant_kaufnest'`

✅ Already applied.

After running it, register the tenant in the control plane — run
`supabase/control-plane/002_register_tenant_kaufnest.sql` in **Project A**.

> ⚠️  **Required follow-up**: also run
> `supabase/migrations/005_grant_tenant_kaufnest_privileges.sql` in **Project
> B**. `create schema` does not grant `anon`/`authenticated`/`service_role`
> any access — without this every PostgREST request against `tenant_kaufnest`
> fails with `permission denied for schema tenant_kaufnest` (42501), checked
> *before* RLS, so correct RLS policies alone aren't enough. ✅ Already applied.

> ⚠️  Do NOT drop the public schema tables until Phase 3 is complete and tested.

> ⚠️  After step 9 of `004_phase2_tenant_kaufnest.sql` runs, existing logged-in
> sessions won't see `app_metadata.tenant_schema` until their JWT refreshes —
> log out and back in to force it. Until then, RLS denies them via
> `is_tenant_member()`.

### Step 2.3 — Link auth.users to tenant schemas

Already handled by `public.set_user_tenant` (defined in
`supabase/migrations/003_saas_functions.sql`) and called in step 9 of
`supabase/migrations/004_phase2_tenant_kaufnest.sql` — no separate action
needed.

---

## Phase 3 — Auth middleware & schema-aware Supabase clients

**Goal**: Every request reads `tenant_schema` from the JWT and routes queries to
the correct schema automatically. No query needs a tenant filter.

### Step 3.1 — Update the route-protection proxy

> ⚠️ **Do not create `src/middleware.ts`.** This Next.js version uses the
> `proxy.ts` file convention instead — having both `src/middleware.ts` and
> `src/proxy.ts` crashes the dev server with "Both middleware file ... and
> proxy file ... are detected." `src/proxy.ts` already exists and handles
> `/dashboard`/`/login` redirects + RBAC; `/admin` already has its own
> server-side guard in `src/app/admin/layout.tsx` (redirects to `/login` if no
> user, to `/dashboard` if not in `control.admin_users`), so no middleware-level
> `/admin` check is needed.

✅ Already applied — `src/proxy.ts`'s RBAC `profiles` lookup uses
`supabase.schema(tenantSchema ?? "public").from("profiles")`, where
`tenantSchema` comes from `user.app_metadata.tenant_schema`. See
`src/lib/supabase/SKILL.md` for why `.schema()` (per-call) is used here
instead of `db.schema` (per-client, used in `server.ts`).

### Step 3.2 — Create schema-aware server client

> ⚠️ **`SET LOCAL search_path` via RPC does NOT work here.** supabase-js
> issues a separate PostgREST HTTP request (and Postgres transaction) per
> `.from()`/`.rpc()` call, so a search_path set during one request has no
> effect on the next. Use the `db: { schema }` client option instead — it sets
> the `Accept-Profile`/`Content-Profile` headers per client instance, which
> PostgREST honours on every request from that client. This is the same
> mechanism as the `.schema('control')` calls in `src/lib/supabase/control.ts`,
> which already work correctly.

✅ Already applied — `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Browser-session-aware server client, scoped to the user's tenant schema.
 * Resolves tenant_schema from the JWT (via a public-schema client), then
 * builds the real client with `db.schema` set to that tenant schema.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const authClient = createServerClient(/* ...anon key, default schema... */);

  const { data: { user } } = await authClient.auth.getUser();
  const tenantSchema = user?.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) return authClient;

  return createServerClient(/* ...anon key..., */ { db: { schema: tenantSchema } });
}

/**
 * Service-role client scoped to a specific tenant schema via `db.schema`.
 */
export function createServiceClientForTenant(schemaName: string) {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: schemaName } }
  );
}
```

### Step 3.3 — Add the tenant schema to "Exposed schemas"

PostgREST refuses requests for any schema not explicitly listed. In **Project
B** dashboard: **Project Settings → API → Data API Settings → Exposed
schemas**, add `tenant_kaufnest` (comma-separated alongside `public`,
`graphql_public`). Without this, every `.from()` call from a client built with
`db: { schema: "tenant_kaufnest" }` fails with a 406/404.

For Phase 4 (dynamically provisioned tenants), each newly created
`tenant_<slug>` schema must also be added here — there's no per-request way
around the exposed-schemas allowlist. Either:
- automate it via the Supabase Management API (`PATCH /v1/projects/{ref}/postgrest`,
  updating `db_schema`) from the provisioning route, or
- accept a manual dashboard step per new tenant until that automation is built.

`public.set_tenant_search_path` (defined in `003_saas_functions.sql`) is no
longer used by app code — kept only for ad-hoc direct-Postgres sessions where
`SET LOCAL search_path` works as expected within a single transaction.

### Step 3.3b — Verify routing before continuing

Before relying on the dashboard "it shows records" check (which is
inconclusive — `public.*` still has the same data copied into
`tenant_kaufnest.*`), prove the client is actually hitting
`tenant_kaufnest`. `company_profile` isn't rendered anywhere in the UI yet, so
use `profiles.full_name` instead — `dashboard/layout.tsx` fetches it via
`createClient()` as the very first query after auth, and `DashboardShell`
renders it in the header and user menu.

1. Find your user id (Project B → Authentication → Users, or
   `select id from auth.users where email = '...'`).
2. In Project B SQL editor, make the same row diverge between schemas:
   ```sql
   update tenant_kaufnest.profiles set full_name = 'Aamir (TENANT)' where id = '<your-user-id>';
   update public.profiles set full_name = 'Aamir (PUBLIC)' where id = '<your-user-id>';
   ```
3. Add `tenant_kaufnest` to Exposed schemas (Step 3.3).
4. Log out and back in — `app_metadata.tenant_schema` was written via SQL
   (Step 2.3), so your *current* session's JWT predates it. A fresh login
   issues a JWT with the updated `app_metadata`.
5. Reload `/dashboard` and check the name shown top-right / in the user menu:
   - **"Aamir (TENANT)"** → routing works correctly.
   - **Redirected back to `/login` in a loop** → the `profiles` query
     returned no row, almost always because `tenant_kaufnest` isn't in
     Exposed schemas yet (Step 3.3) — PostgREST errors on `db.schema`,
     `.single()` returns `null`, and `dashboard/layout.tsx` redirects on
     `!profile`. Fix Step 3.3 and reload.
   - **"Aamir (PUBLIC)"** → still on `public`, meaning `tenant_schema` is
     missing from your JWT — log out/in again and confirm Step 2.3's
     `set_user_tenant` ran for your user id.

### Step 3.4 — Add CompanyProfile to types and Redux

Add to `src/types/index.ts`:

```ts
export interface CompanyProfile {
  id: string;
  name: string;
  logo_url: string | null;
  vat_number: string | null;
  address: string | null;
  currency: Currency;
  timezone: string;
  updated_at: string;
}
```

Create `src/store/slices/companyProfileSlice.ts` following the same pattern as
`currentUserSlice`. The slice holds `CompanyProfile | null` and exposes a
`hydrateCompanyProfile` action.

### Step 3.5 — Hydrate company_profile in dashboard layout

In `src/app/dashboard/layout.tsx`, add a fetch for `company_profile` alongside
the existing fetches, and pass it to `StoreProvider`. Also update
`StoreProvider.tsx` to accept and dispatch it.

```ts
const { data: companyProfile } = await supabase
  .from("company_profile")
  .select("*")
  .single<CompanyProfile>();
```

### Step 3.6 — Delete public schema tables (after testing)

> ✅ Resolved: `handle_new_user()` (from `001_init.sql`) was an `AFTER INSERT
> ON auth.users` trigger that inserted into `public.profiles` on every
> signup/invite — if `public.profiles` were dropped first, every new
> signup/invite would fail (the trigger's exception rolls back the entire
> `auth.users` insert). `supabase/migrations/006_remove_handle_new_user_trigger.sql`
> drops the trigger and function. `src/app/api/users/invite/route.ts` no
> longer relies on it: it now reads the caller's `tenant_schema` from
> `app_metadata`, inserts the new user's profile directly into
> `tenant_<schema>.profiles` via `createServiceClientForTenant()`, and stamps
> the new user's own `app_metadata.tenant_schema` via `set_user_tenant`.
> Run `006_remove_handle_new_user_trigger.sql` before proceeding below.

> ✅ Resolved: `src/lib/supabase/client.ts` (the browser client used by every
> Add/Edit/Delete/Import modal in Sales/Purchases/Expenses/Inventory/Users) had
> no schema awareness and defaulted to `public` for all `.from()` calls — these
> writes would all break the moment `public.*` is dropped. `createBrowserClient`
> caches a singleton and ignores `db.schema` on every call after the first, so
> the server-side fix (build a second client with `db: { schema }`) doesn't work
> here. Instead, added `createTenantClient()`, an async helper that calls
> `.schema(tenantSchema)` per call on the existing singleton (same mechanism
> `src/proxy.ts` uses) — `.schema()` still routes through the singleton's
> authenticated fetch, so RLS/`auth.uid()` work normally. All 18 client-component
> call sites and `lib/utils/audit.ts` (`writeAuditLog`) now use
> `await createTenantClient()` instead of `createClient()`. See
> `src/lib/supabase/SKILL.md` for the full writeup.

Only after Phase 3 is confirmed working in your browser for all features
(Step 3.3b) **and** migration 006 has been run:

```sql
-- Run in Project B — this is irreversible
DROP TABLE IF EXISTS public.expenses CASCADE;
DROP TABLE IF EXISTS public.sales CASCADE;
DROP TABLE IF EXISTS public.purchases CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
```

---

## Phase 4 — Provisioning Engine

**Goal**: An API route that creates a new tenant schema end-to-end when a
company signs up or you manually add them from the admin panel.

### Step 4.1 — Create provisioning route

Create `src/app/api/admin/provision-tenant/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function POST(req: NextRequest) {
  // Verify caller is a KaufNest admin (check Authorization header or session)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.ADMIN_API_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    name: string;
    slug: string;
    plan: string;
    adminEmail: string;
    adminName?: string;
  };

  const { name, slug, plan, adminEmail, adminName = "" } = body;

  // Sanitise slug — alphanumeric + hyphens only, converted to underscores
  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-/g, "_");
  const schemaName = `tenant_${safeSlug}`;

  const control = createControlClient();

  // Check slug uniqueness
  const { data: existing } = await control
    .from("control.tenants")
    .select("id")
    .eq("slug", safeSlug)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
  }

  try {
    // 1. Create schema in Data Plane (Project B)
    const service = createServiceClientForTenant(schemaName);
    await service.rpc("provision_tenant_schema", { schema_name: schemaName });

    // 2. Seed company_profile
    await service.rpc("set_tenant_search_path", { schema_name: schemaName });
    await service
      .from("company_profile")
      .insert({ name, currency: "EUR", timezone: "UTC" });

    // 3. Invite admin user via Supabase Auth
    const { data: inviteData, error: inviteError } = await service.auth.admin.inviteUserByEmail(
      adminEmail,
      { data: { full_name: adminName, tenant_schema: schemaName, role: "super_admin" } }
    );

    if (inviteError) throw inviteError;

    // 4. Create profile row in tenant schema
    if (inviteData.user) {
      await service.rpc("set_tenant_search_path", { schema_name: schemaName });
      await service.from("profiles").insert({
        id: inviteData.user.id,
        email: adminEmail,
        full_name: adminName,
        role: "super_admin",
      });

      // 5. Stamp tenant_schema onto auth.users app_metadata
      await service.rpc("set_user_tenant", {
        user_id: inviteData.user.id,
        schema_name: schemaName,
      });
    }

    // 6. Register tenant in control plane
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    await control.from("control.tenants").insert({
      name,
      slug: safeSlug,
      schema_name: schemaName,
      plan,
      status: "active",
      trial_ends_at: trialEnd.toISOString(),
    });

    return NextResponse.json({ ok: true, schemaName });
  } catch (err: unknown) {
    console.error("Provisioning failed:", err);
    return NextResponse.json(
      { error: "Provisioning failed", detail: String(err) },
      { status: 500 }
    );
  }
}
```

### Step 4.2 — Create provision_tenant_schema SQL function

In **Project B** SQL editor:

```sql
-- Called by the provisioning API to create a fresh tenant schema.
-- Runs as SECURITY DEFINER with service-role credentials so it can
-- CREATE SCHEMA and CREATE TABLE.
CREATE OR REPLACE FUNCTION public.provision_tenant_schema(schema_name text)
RETURNS void AS $$
DECLARE
  sql text;
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;

  -- Create schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  -- Set search path and run table definitions
  EXECUTE format('SET search_path TO %I', schema_name);

  -- profiles
  EXECUTE format($sql$
    CREATE TABLE %I.profiles (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      full_name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'accountant'
        CHECK (role IN (''super_admin'', ''admin'', ''accountant'')),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- Repeat for expenses, sales, purchases, products, audit_logs, company_profile
  -- (copy each CREATE TABLE block from tenant-schema-template.sql)
  -- ...

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

> Tip: Rather than embedding all DDL in a PL/pgSQL string, you can use the
> Supabase Management API to run raw SQL against Project B from your Node
> provisioning script. That approach is easier to maintain — keep the template
> SQL in `supabase/tenant-schema-template.sql` and `exec` it with the schema
> name substituted.

### Step 4.3 — Add ADMIN_API_SECRET to environment

```
ADMIN_API_SECRET=<long random string — generate with openssl rand -hex 32>
```

---

## Phase 5 — Stripe Billing

**Goal**: Attach a Stripe subscription to each tenant. Webhooks keep the
control plane in sync.

### Step 5.1 — Install Stripe

```bash
npm install stripe
```

### Step 5.2 — Define pricing plans

In the Stripe dashboard, create three Products with monthly and annual Prices:

| Plan     | Features                          |
| -------- | --------------------------------- |
| Starter  | 1 user, manual entry, VAT reports |
| Pro      | 5 users, platform integrations    |
| Business | Unlimited users, AI features      |

Save each Price ID (e.g. `price_xxx`) — you'll reference them in the app.

Create `src/lib/stripe.ts`:

```ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export const PLANS = {
  starter:  { monthly: "price_starter_monthly",  annual: "price_starter_annual"  },
  pro:      { monthly: "price_pro_monthly",       annual: "price_pro_annual"       },
  business: { monthly: "price_business_monthly",  annual: "price_business_annual"  },
} as const;
```

### Step 5.3 — Create checkout session route

Create `src/app/api/billing/checkout/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const tenantSchema = user.app_metadata?.tenant_schema as string;
  const { priceId } = await req.json() as { priceId: string };

  const control = createControlClient();
  const { data: tenant } = await control
    .from("control.tenants")
    .select("*")
    .eq("schema_name", tenantSchema)
    .single();

  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  // Create or reuse Stripe customer
  let stripeCustomerId = tenant.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { tenant_schema: tenantSchema, tenant_id: tenant.id },
    });
    stripeCustomerId = customer.id;
    await control
      .from("control.tenants")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", tenant.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?billing=success`,
    cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?billing=cancelled`,
    metadata: { tenant_id: tenant.id },
  });

  return NextResponse.json({ url: session.url });
}
```

### Step 5.4 — Create Stripe webhook route

Create `src/app/api/billing/webhook/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import type Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const control = createControlClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await control
        .from("control.tenants")
        .update({
          stripe_subscription_id: sub.id,
          plan:   sub.metadata.plan ?? "starter",
          status: sub.status === "active" ? "active" : "inactive",
        })
        .eq("stripe_customer_id", sub.customer as string);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await control
        .from("control.tenants")
        .update({ status: "cancelled" })
        .eq("stripe_customer_id", sub.customer as string);
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      await control
        .from("control.tenants")
        .update({ status: "inactive" })
        .eq("stripe_customer_id", inv.customer as string);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
```

Register the webhook in the Stripe dashboard pointing to:
`https://<your-domain>/api/billing/webhook`

### Step 5.5 — Gate features by plan

Create `src/lib/utils/planGating.ts`:

```ts
import type { TenantPlan } from "@/types";

const PLAN_LIMITS: Record<TenantPlan, { maxUsers: number; platformIntegrations: boolean; aiFeatures: boolean }> = {
  trial:    { maxUsers: 3,         platformIntegrations: false, aiFeatures: false },
  starter:  { maxUsers: 1,         platformIntegrations: false, aiFeatures: false },
  pro:      { maxUsers: 5,         platformIntegrations: true,  aiFeatures: false },
  business: { maxUsers: Infinity,  platformIntegrations: true,  aiFeatures: true  },
};

export function getPlanLimits(plan: TenantPlan) {
  return PLAN_LIMITS[plan];
}

export function canAddUser(plan: TenantPlan, currentUserCount: number): boolean {
  return currentUserCount < PLAN_LIMITS[plan].maxUsers;
}
```

---

## Phase 6 — KaufNest Admin Panel

**Goal**: A protected `/admin` section where you can view all tenants, provision
new ones, manage subscriptions, and impersonate any tenant for support.

### Step 6.1 — Create admin layout

Create `src/app/admin/layout.tsx`:

```ts
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify this user is a KaufNest admin
  const control = createControlClient();
  const { data: adminUser } = await control
    .from("control.admin_users")
    .select("id")
    .eq("email", user.email)
    .single();

  if (!adminUser) redirect("/dashboard"); // not a KaufNest admin

  return <>{children}</>;
}
```

### Step 6.2 — Create admin tenant list page

Create `src/app/admin/page.tsx` with the following sections:

- **Stats header**: total tenants, active, trial, cancelled
- **Tenants table**: name, plan, status, created date, actions (View, Edit Plan,
  Provision Users, Impersonate)
- **Add Tenant button**: opens a modal that calls `/api/admin/provision-tenant`

The page fetches from `control.tenants` using `createControlClient()`.

### Step 6.3 — Impersonation flow

When you click **Impersonate** on a tenant:

1. Call a server action or API route that uses the service-role key to generate
   a magic link for a super_admin user in that tenant schema.
2. The magic link logs you in as that user (their JWT will have their
   `tenant_schema` in app_metadata).
3. Log the impersonation event to `control.audit_log` (create this table in
   Phase 1 alongside `tenants`).
4. Show a persistent banner in the dashboard: "Viewing as Tenant: Acme Ltd —
   Exit impersonation". The banner reads a `kaufnest_impersonating` cookie set
   during step 1.

Create `src/app/api/admin/impersonate/route.ts` that:
- Verifies the caller is a control plane admin
- Uses `supabase.auth.admin.generateLink({ type: 'magiclink', email: tenantAdminEmail })`
- Sets `kaufnest_impersonating=<tenant_name>` cookie (httpOnly, sameSite)
- Returns the magic link URL to redirect the admin to

---

## Phase 7 — Tenant Self-Serve Signup (future)

When you are ready for public signups (not needed for manual provisioning):

1. Create `src/app/(marketing)/page.tsx` — landing page with pricing table
2. Create `src/app/(marketing)/signup/page.tsx` — company name + admin email form
3. On submit, call `/api/billing/checkout` to start Stripe checkout
4. On Stripe `checkout.session.completed` webhook, call the provisioning logic
   (currently in `/api/admin/provision-tenant`) — extract it into a shared
   `lib/tenants/provision.ts` function so both routes use the same code
5. Send a welcome email via Resend or similar with the login link

---

## Key rules for all future Claude Code sessions

These rules apply to every task that touches this codebase after Phase 1 is
complete:

1. **Never query `public.*` tables** — all data lives in tenant schemas.
   Queries must go through `createClient()` (which sets `db.schema` to the
   tenant's schema) or `createServiceClientForTenant(schemaName)`. Do not use
   `set_tenant_search_path` for routing — see Step 3.2.

2. **Never hardcode a schema name** — always read it from
   `user.app_metadata.tenant_schema` or the `Tenant` object from the control
   plane.

3. **Never skip the schema validation guard** — the
   `provision_tenant_schema` SQL function rejects schema names that don't
   start with `tenant_`. Do not bypass this. Any new tenant schema must also
   be added to Project B's "Exposed schemas" API setting (Step 3.3) or
   PostgREST will reject all requests to it.

4. **Control plane access is server-only** — `createControlClient()` uses the
   service-role key. Never import it into Client Components or expose its
   credentials to the browser.

5. **Stripe webhooks are the source of truth for plan/status** — never update
   `plan` or `status` in `control.tenants` directly from the UI. Only webhooks
   and the provisioning route may write those fields.

6. **Schema migrations apply to all tenants** — when you add a column or table,
   update `supabase/tenant-schema-template.sql` AND write a migration script
   that runs `ALTER TABLE` in every existing `tenant_*` schema. Add a utility
   function `src/lib/tenants/runMigrationOnAllTenants.ts` for this purpose.

7. **Update AGENTS.md and feature CLAUDE.md files** after every phase — the
   working agreement in `AGENTS.md` (especially the data-flow section) must
   reflect the schema-aware client pattern once Phase 3 is live.

---

## Checklist — phase completion gates

Before marking a phase done, verify:

### Phase 1
- [ ] Project A exists in Supabase dashboard
- [ ] `control.tenants` and `control.admin_users` tables exist in Project A
- [ ] Your email is in `control.admin_users`
- [ ] `createControlClient()` file exists and imports from correct env vars

### Phase 2
- [x] `tenant_kaufnest` schema exists in Project B with all tables
- [x] All existing data copied and row counts match
- [x] `set_user_tenant()` function exists and all existing users are stamped
- [x] `anon`/`authenticated`/`service_role` granted USAGE + table privileges on
      `tenant_kaufnest` (`005_grant_tenant_kaufnest_privileges.sql`)

### Phase 3
- [x] `createClient()` in `server.ts` builds a `db: { schema: tenantSchema }` client
- [x] `tenant_kaufnest` added to Project B's "Exposed schemas" API setting (Step 3.3)
- [x] Routing verified with the diverging-value test (Step 3.3b) — confirmed
      `/dashboard` reads from `tenant_kaufnest`, not `public`
- [x] `handle_new_user` trigger reworked/removed
      (`006_remove_handle_new_user_trigger.sql`) and `users/invite/route.ts`
      made tenant-aware
- [x] Browser client (`createTenantClient()` in `lib/supabase/client.ts`) is
      schema-aware; all 18 client-component CRUD call sites + `writeAuditLog`
      updated — pending manual browser test of Sales/Purchases/Expenses/
      Inventory/Users CRUD against `tenant_kaufnest`
- [ ] Public schema tables dropped (only after the above are confirmed)

### Phase 4
- [ ] `/api/admin/provision-tenant` creates schema + profile + auth user in one call
- [ ] New tenant's admin receives invite email and can log in
- [ ] New tenant's data is fully isolated (cannot see KaufNest data)

### Phase 5
- [ ] `/admin` redirects non-admins to `/dashboard`
- [ ] Tenant list shows all tenants from control plane
- [ ] Provisioning form creates a new tenant end-to-end
- [ ] Impersonation generates a valid magic link and sets the banner cookie
