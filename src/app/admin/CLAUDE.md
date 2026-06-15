# KaufNest platform admin panel

Route: `/admin`. This is **not** a tenant feature — it's the KaufNest-internal
"Tenant Management" dashboard used to provision new tenants and impersonate
their admins. Gated to platform staff via `control.admin_users` (Project A),
not tenant roles.

## Files in this folder

- `layout.tsx` — server component auth guard: redirects to `/login` if no
  session, then redirects to `/dashboard` if `isPlatformAdmin(user.email)`
  (`@/lib/supabase/control`) is `false`. Renders the admin header/shell, wrapped
  in `<ToastProvider>` so `_components/*` can call `useToast()`.
- `page.tsx` — "Tenant Management" page: stats cards (Total/Active/Trial/
  Cancelled) + tenants table (Tenant, **Admin Email**, Plan, Status, Trial
  Ends, Created, Actions), fetched client-side from `GET /api/admin/tenants`.
  "Add Tenant" button opens `AddTenantModal`; closing it bumps `refreshKey` to
  refetch the list.
- `_components/AddTenantModal.tsx` — "Provision New Tenant" form (company
  name → auto-slug, plan, admin email/name). Posts to
  `/api/admin/provision-tenant`. On failure shows `data.detail ?? data.error`
  both inline (red banner in the form) and via `useToast().error(...)`; on
  success shows a `useToast().success(...)` toast before closing.
- `_components/TenantActions.tsx` — per-row "Impersonate" button. Prompts for
  the tenant's super_admin email, posts to `/api/admin/impersonate`, then
  redirects the browser to the returned magic link.

## API routes (cannot be colocated — Next.js pins routes to `app/api/...`)

All under `src/app/api/admin/`, all guarded by a local `verifyPlatformAdmin()`
(or, in `layout.tsx`/`dashboard/layout.tsx`, a direct call) that wraps the
shared `isPlatformAdmin(email)` helper (`@/lib/supabase/control`):

- **`provision-tenant/route.ts`** (`POST`) — the "invite tenant + initial
  setup" flow, in order:
  1. Sanitize `slug` → `schemaName = tenant_<slug>`; reject if the slug is
     already in `control.tenants`.
  2. `service.rpc("provision_tenant_schema", { schema_name })` — creates the
     full `tenant_<slug>` schema (tables, RLS, triggers, indexes, grants); see
     `supabase/migrations/005_tenant_provisioning.sql`.
  3. `addExposedSchema(schemaName)` (`@/lib/supabase/managementApi`) — adds
     the new schema to Project B's PostgREST "Exposed schemas" via the
     Supabase Management API. **Must** run before step 4/5, which use
     `createServiceClientForTenant(schemaName)` (PostgREST calls that 404/406
     against an unexposed schema).
  4. Seed `company_profile` (name, EUR, UTC) in the new schema — skipped if a
     row already exists (retry-safe for the same `schemaName`).
  5. `service.auth.admin.inviteUserByEmail(adminEmail, { redirectTo:
     "${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password", data: {
     full_name, tenant_schema, role: "super_admin" } })` — same `redirectTo`
     pattern as `/api/users/invite`, kept for compatibility, but the invite
     email's actual link is built by `email-templates/invite.html` from
     `{{ .SiteURL }}`, not `redirectTo` (see `src/app/(auth)/SKILL.md`). If
     `adminEmail` already belongs to another tenant (detected
     via `inviteData.user.app_metadata.tenant_schema`), provisioning aborts
     with `detail: 'Admin email "..." is already associated with another
     tenant...'` — see the duplicate-email gotcha in `SKILL.md`. Otherwise,
     insert the matching `profiles` row and
     `service.rpc("set_user_tenant", ...)` to stamp `app_metadata.tenant_schema`
     (belt-and-suspenders — `inviteUserByEmail`'s `data` only sets
     `user_metadata`; `set_user_tenant` is the canonical `app_metadata` writer
     used everywhere else).
  6. Register the tenant in `control.tenants` (plan, `admin_email`,
     `status: "active"`, `trial_ends_at` = now + 14 days).

  On any thrown error, returns `{ error: "Provisioning failed", detail }`
  (500) where `detail` is the underlying Supabase/Postgres error message
  (`errorMessage()` helper unwraps `PostgrestError`/`AuthError`-shaped objects
  that aren't `instanceof Error`) — `AddTenantModal` surfaces `detail` to the
  admin via toast + inline banner.
- **`tenants/route.ts`** (`GET`) — lists `control.tenants`, newest first.
- **`impersonate/route.ts`** (`POST`) — looks up the tenant in
  `control.tenants`, generates a Supabase magic link
  (`service.auth.admin.generateLink`) for the given admin email, and sets the
  `kaufnest_impersonating` cookie (httpOnly, 8h) read by `DashboardShell`'s
  impersonation banner.
- **`exit-impersonation/route.ts`** (`POST`) — clears the
  `kaufnest_impersonating` cookie.

## Shared dependencies

- `src/lib/supabase/control.ts` (`createControlClient`, `isPlatformAdmin`) —
  Project A, server-only. `isPlatformAdmin(email)` is also called from
  `dashboard/layout.tsx` to decide whether to show the sidebar's "Admin Panel"
  link (see `src/app/dashboard/CLAUDE.md`).
- `src/lib/supabase/server.ts` (`createServiceClientForTenant`) — Project B,
  schema-scoped service-role client for tenant-table seeding.
- `src/lib/supabase/managementApi.ts` (`addExposedSchema`) — Project B's
  Management API, for the Exposed-schemas step.
- `components/ui/{Button,Badge,Modal,FormFields}`, `types` (`Tenant` — incl.
  `admin_email`, `TenantPlan`, `TenantStatus`).

## Tests

No test suite targets this folder — it's almost entirely Supabase/network
calls (provisioning, impersonation, control-plane queries), which the working
agreement keeps out of unit tests. Verify by using `/admin` → "Add Tenant" in
the browser.
