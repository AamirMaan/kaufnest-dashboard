---
name: lib-supabase
description: Reference for the Supabase client factories in src/lib/supabase (client.ts, server.ts) — use when wiring up a new Supabase call site or wondering which client to import in Client vs. Server Components/Actions/Route Handlers.
---

# Supabase clients (`src/lib/supabase/`)

Two thin factories around `@supabase/ssr`, split by execution context. Both
read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from env —
there's nothing else to configure here.

## client.ts

- `export function createClient()` — wraps `createBrowserClient`. Synchronous,
  returns a `public`-schema singleton. Use **only** for auth-only operations
  (sign in/out, password reset/invite callbacks) — `(auth)/*`,
  `DashboardShell`'s sign-out.
- `export async function createTenantClient()` — **use this for all tenant
  table access from Client Components** (`pages.tsx`/`_components/*Modal.tsx`
  in Sales/Purchases/Expenses/Inventory/Users). Reads the current session via
  `createClient().auth.getSession()`, then returns
  `{ auth, from, rpc }` where `from`/`rpc` are bound to
  `client.schema(tenantSchema)`. Always `await` it — it's async because
  reading the session is async.
  - Returns a `TenantClient` (exported type) — `writeAuditLog`
    (`@/lib/utils/audit`) takes this type, not `SupabaseClient`.
  - **Why not `db: { schema }` like server.ts**: `createBrowserClient` caches
    a singleton and *ignores* the `options` argument (including `db.schema`)
    on every call after the first — see
    `node_modules/@supabase/ssr/dist/main/createBrowserClient.js`. So
    `createTenantClient()` instead calls `.schema(tenantSchema)` per call on
    the singleton (same mechanism `proxy.ts` uses for its RBAC lookup) — this
    still goes through the singleton's authenticated fetch, so RLS/`auth.uid()`
    work normally.

## server.ts

`export async function createClient()` — wraps `createServerClient`, reading/
writing auth cookies via `next/headers` `cookies()`. **Async** — always
`await createClient()`. Use in Server Components, Server Actions, and Route
Handlers.

- The `setAll` cookie writer is wrapped in `try/catch` and swallows errors —
  this is expected when called from a Server Component (cookies can only be
  set in a Server Action/Route Handler/middleware); the comment in the file
  explains middleware handles it in that case.
- **Tenant-scoped (post Phase 3)**: `createClient()` first builds a
  public-schema client to call `auth.getUser()`, reads
  `user.app_metadata.tenant_schema`, then — if present — builds and returns a
  *second* client constructed with `db: { schema: tenantSchema }`. All
  `.from()`/`.rpc()` calls on the returned client are routed to that schema
  via the `Accept-Profile`/`Content-Profile` headers. If there's no
  `tenant_schema` in the JWT, the public-schema client is returned as-is.
- `createServiceClientForTenant(schemaName)` likewise passes
  `db: { schema: schemaName }` to the service-role client — used by
  `/api/admin/provision-tenant` for inserts into a newly created tenant
  schema, and by `/api/users/invite` to write the invited user's profile row
  into the inviting super_admin's tenant schema.
- `createServiceClientForTenant` and the other Project B service-role clients
  (`provision-tenant`, `impersonate`, `users/invite`) all read
  `process.env.SUPABASE_SERVICE_ROLE_KEY` — the same var name `.env.local`
  already had pre-migration. Don't introduce a differently-named
  `SUPABASE_SERVICE_KEY`; keep this one name everywhere.
- **`set_tenant_search_path` was removed entirely** (it was never used by app
  code) — `SET LOCAL search_path` only lasts for that RPC's own transaction,
  and supabase-js makes a separate request/transaction per call, so it would
  have had no effect on subsequent queries anyway. `db.schema` (or `.schema()`)
  is the working alternative used everywhere.
- **Gotcha**: any schema passed via `db.schema` (or `.schema()`, see below)
  must be listed in the Supabase project's "Exposed schemas" API setting
  (Project Settings → API → Data API Settings) or PostgREST rejects the
  request. `tenant_kaufnest` is already listed; new tenant schemas created by
  `/api/admin/provision-tenant` are added automatically via
  `addExposedSchema()` (see below).

## managementApi.ts

`export async function addExposedSchema(schemaName: string)` — the only
caller is `/api/admin/provision-tenant`. Uses the Supabase **Management API**
(`api.supabase.com`, not the project's own PostgREST endpoint) to add
`schemaName` to Project B's "Exposed schemas" (`db_schema`) config, so the
inserts that follow (`company_profile`, `profiles` via
`createServiceClientForTenant`) don't 404/406.

- Requires `SUPABASE_ACCESS_TOKEN` (a personal access token from
  https://supabase.com/dashboard/account/tokens) — separate from
  `SUPABASE_SERVICE_ROLE_KEY` and `CONTROL_SUPABASE_SERVICE_KEY`. This token
  is account-scoped (Management API has no per-project token scoping), so
  treat it as sensitive as the service-role keys.
- Project ref is derived from `NEXT_PUBLIC_SUPABASE_URL`
  (`https://<ref>.supabase.co`) — no separate ref env var.
- Idempotent: no-ops if `schemaName` is already in `db_schema`.
- **Gotcha**: after a successful `PATCH`, PostgREST reloads its schema cache
  asynchronously. `addExposedSchema` adds a fixed ~2s delay before returning to
  avoid the very next request racing the reload. If provisioning still 404s on
  `company_profile`/`profiles` right after this step, the reload may need more
  time — don't remove the delay without a retry/backoff in its place.

## control.ts

`createControlClient()` — server-only client for Project A (control plane,
`control` schema): `control.tenants` + `control.admin_users`. Used by
`src/app/admin/*`, `src/app/api/admin/*`, and `src/app/dashboard/layout.tsx`.

`isPlatformAdmin(email)` — `true` if `email` is in `control.admin_users`.
Single source of truth for "is this user KaufNest platform staff", called
from:
- `src/app/admin/layout.tsx` — redirects to `/dashboard` if `false`.
- `src/app/api/admin/*/route.ts`'s local `verifyPlatformAdmin()` wrappers.
- `src/app/dashboard/layout.tsx` — gates the sidebar's "Admin Panel" link
  (only shown if also `role === "super_admin"`, see
  `src/app/dashboard/CLAUDE.md`).

## Gotcha: `src/proxy.ts` doesn't use either of these

The route-protection proxy (this project's middleware-equivalent — see the
`AGENTS.md` note about this Next.js version's breaking changes) builds its
own inline `createServerClient` instead of importing `server.ts`. That's
because middleware needs to mutate cookies directly on the in-flight
`NextRequest`/`NextResponse` pair, which `cookies()` from `next/headers`
can't do. If you change the cookie-handling shape in `server.ts`, check
whether `src/proxy.ts` needs the same treatment.

For its RBAC `profiles` lookup, `proxy.ts` uses the **per-call** `.schema()`
method (`supabase.schema(tenantSchema).from("profiles")`, defaulting to
`"public"` if the JWT has no `tenant_schema` yet) — this is the same
underlying header-based mechanism as `db.schema`, just applied per-query
instead of at client construction, since the proxy reuses one client for both
`auth.getUser()` (default schema) and the profiles query (tenant schema).

## Where these are used

Every feature that reads/writes Supabase imports one of these — pages and
`_components/*Modal.tsx` files use `client.ts` (they're Client Components),
while `app/auth/confirm/route.ts` and `app/api/users/invite/route.ts` use
`server.ts`. `DashboardShell` and `dashboard/layout.tsx` also use the server
client for the auth-guard/data-hydration pass.

## Gotchas

- **`addExposedSchema` is a read-modify-write on one global string, and it
  self-verifies for that reason (hardened 2026-08-28).** Project B's PostgREST
  "Exposed schemas" setting is a single comma-separated list shared by every
  tenant. Two concurrent provisions can lose an update — both read, both
  append, the second PATCH wins and the first schema is silently never
  exposed, leaving that tenant's whole app returning 404/406 with nothing in
  any log. The function now re-reads after PATCHing and retries until it sees
  its own schema (4 attempts, 2s apart), which converges because each attempt
  re-reads the current value. **Do not "simplify" this back into a single
  read-then-PATCH.** Note the blast radius that makes this worth the care:
  `removeExposedSchema`'s own docs record that a malformed list makes
  PostgREST fail its schema-cache load (`3F000`) and return `PGRST002` for
  *every* tenant.
