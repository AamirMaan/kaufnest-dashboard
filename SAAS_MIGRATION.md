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
SUPABASE_SERVICE_KEY=<project-b-service-role-key>

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

In the Supabase SQL editor for **Project A**, run:

```sql
-- Control plane schema
CREATE SCHEMA IF NOT EXISTS control;

CREATE TABLE control.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,          -- used as schema name: tenant_<slug>
  schema_name   text NOT NULL UNIQUE,          -- e.g. tenant_acme
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan          text NOT NULL DEFAULT 'trial', -- trial | starter | pro | business
  status        text NOT NULL DEFAULT 'active',-- active | inactive | cancelled
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.admin_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  can_impersonate  boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Seed yourself as the first admin
INSERT INTO control.admin_users (email) VALUES ('muhammadaamir.sohail94@gmail.com');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION control.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON control.tenants
  FOR EACH ROW EXECUTE FUNCTION control.set_updated_at();
```

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

In the Supabase SQL editor for **Project B**, run:

```sql
-- 1. Create schema for the first tenant (your own company)
CREATE SCHEMA tenant_kaufnest;

-- 2. Copy table definitions (run tenant-schema-template.sql with search_path set)
SET search_path TO tenant_kaufnest;
-- ... paste full contents of tenant-schema-template.sql here ...

-- 3. Copy existing data from public schema
INSERT INTO tenant_kaufnest.profiles SELECT * FROM public.profiles;
INSERT INTO tenant_kaufnest.expenses SELECT * FROM public.expenses;
INSERT INTO tenant_kaufnest.sales    SELECT * FROM public.sales;
INSERT INTO tenant_kaufnest.purchases SELECT * FROM public.purchases;
INSERT INTO tenant_kaufnest.products  SELECT * FROM public.products;
INSERT INTO tenant_kaufnest.audit_logs SELECT * FROM public.audit_logs;

-- 4. Seed company_profile for your tenant
INSERT INTO tenant_kaufnest.company_profile (name, currency, timezone)
VALUES ('KaufNest', 'EUR', 'UTC');

-- 5. Register in control plane (run this in Project A)
-- INSERT INTO control.tenants (name, slug, schema_name, plan, status)
-- VALUES ('KaufNest', 'kaufnest', 'tenant_kaufnest', 'business', 'active');
```

> ⚠️  Do NOT drop the public schema tables until Phase 3 is complete and tested.

### Step 2.3 — Link auth.users to tenant schemas

Each user in `auth.users` needs to know which tenant schema they belong to.
Store this in Supabase Auth app_metadata (set server-side, never writable by
the user):

In **Project B** SQL editor:

```sql
-- Helper function to stamp tenant_schema onto a user's app_metadata
CREATE OR REPLACE FUNCTION public.set_user_tenant(
  user_id uuid,
  schema_name text
) RETURNS void AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('tenant_schema', schema_name)
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Stamp all existing users with the kaufnest schema
SELECT public.set_user_tenant(id, 'tenant_kaufnest')
FROM auth.users;
```

---

## Phase 3 — Auth middleware & schema-aware Supabase clients

**Goal**: Every request reads `tenant_schema` from the JWT and routes queries to
the correct schema automatically. No query needs a tenant filter.

### Step 3.1 — Update Next.js middleware

Replace or create `src/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Protect /dashboard routes
  if (request.nextUrl.pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Protect /admin routes — check control plane admin_users table
  if (request.nextUrl.pathname.startsWith("/admin") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
```

### Step 3.2 — Create schema-aware server client

Replace `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Browser-session-aware server client.
 * Reads tenant_schema from the user's JWT app_metadata and sets
 * search_path so every query automatically hits the right schema.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => {
          try {
            cookies.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* Server Component — middleware handles it */ }
        },
      },
    }
  );

  // Read tenant_schema from JWT and set search_path
  const { data: { user } } = await client.auth.getUser();
  const tenantSchema = user?.app_metadata?.tenant_schema as string | undefined;

  if (tenantSchema) {
    // Set search_path for this connection so table references resolve to the
    // tenant schema without needing schema prefixes in every query.
    await client.rpc("set_tenant_search_path", { schema_name: tenantSchema });
  }

  return client;
}

/**
 * Service-role client for a specific tenant schema.
 * Use in server-side provisioning and admin operations only.
 */
export function createServiceClientForTenant(schemaName: string) {
  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  // Caller must set search_path before querying:
  // await client.rpc("set_tenant_search_path", { schema_name: schemaName });
  return client;
}
```

### Step 3.3 — Create the set_tenant_search_path RPC

In **Project B** SQL editor:

```sql
-- Callable by authenticated users to set their session search_path.
-- This is safe — each tenant's schema is isolated by RLS and by not
-- having cross-tenant references.
CREATE OR REPLACE FUNCTION public.set_tenant_search_path(schema_name text)
RETURNS void AS $$
BEGIN
  -- Validate: schema must start with 'tenant_' to prevent injection
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;
  EXECUTE format('SET LOCAL search_path TO %I, public', schema_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

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

Only after Phase 3 is confirmed working in your browser for all features:

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
   Queries must go through `createClient()` (which sets `search_path`) or
   `createServiceClientForTenant(schemaName)` followed by
   `set_tenant_search_path`.

2. **Never hardcode a schema name** — always read it from
   `user.app_metadata.tenant_schema` or the `Tenant` object from the control
   plane.

3. **Never skip the schema validation guard** — the
   `set_tenant_search_path` and `provision_tenant_schema` SQL functions both
   reject schema names that don't start with `tenant_`. Do not bypass this.

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
- [ ] `tenant_kaufnest` schema exists in Project B with all tables
- [ ] All existing data copied and row counts match
- [ ] `set_user_tenant()` function exists and all existing users are stamped
- [ ] `set_tenant_search_path()` RPC exists and rejects non-`tenant_` names

### Phase 3
- [ ] `createClient()` in `server.ts` calls `set_tenant_search_path` on every request
- [ ] Loading `/dashboard` still works — data loads from `tenant_kaufnest`
- [ ] Public schema tables dropped (only after browser testing)

### Phase 4
- [ ] `/api/admin/provision-tenant` creates schema + profile + auth user in one call
- [ ] New tenant's admin receives invite email and can log in
- [ ] New tenant's data is fully isolated (cannot see KaufNest data)

### Phase 5
- [ ] `/admin` redirects non-admins to `/dashboard`
- [ ] Tenant list shows all tenants from control plane
- [ ] Provisioning form creates a new tenant end-to-end
- [ ] Impersonation generates a valid magic link and sets the banner cookie
