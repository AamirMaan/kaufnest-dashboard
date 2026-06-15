---
name: admin-panel
description: Reference for the KaufNest platform admin panel at src/app/admin (route /admin) and its API routes in src/app/api/admin — use when adding/changing tenant provisioning, impersonation, or the platform admin dashboard.
---

# Working on the admin panel

Read `CLAUDE.md` in this folder first — it has the full file map for both
`src/app/admin/` and `src/app/api/admin/*` (the latter can't be colocated due
to Next.js route pinning, same as `api/users/invite`).

This folder is **platform-side**, gated by `control.admin_users` (Project A) —
not tenant RBAC. Don't reuse tenant role checks (`current_user_role()`,
`profile.role`) here.

## Minimal file set for common changes

- **Change the provisioning flow** (new field on signup, extra setup step):
  `_components/AddTenantModal.tsx` (form) + `api/admin/provision-tenant/route.ts`
  (backend). If the new field belongs to every tenant schema, also update
  `supabase/migrations/005_tenant_provisioning.sql` per the "3 places" rule in
  `supabase/SKILL.md`.
- **Change the tenants table/stats**: `page.tsx` + `api/admin/tenants/route.ts`
  (new columns are automatic via `select("*")`, but each new column needs:
  the field on `Tenant` in `types/index.ts`, a `<th>`/`<td>` pair in
  `page.tsx`'s table, and — if set at provision time — an insert field in
  `provision-tenant/route.ts` step 6 and, for already-provisioned tenants, a
  migration in `supabase/control-plane/`. `admin_email` is an example of all
  four).
- **Change impersonation**: `_components/TenantActions.tsx` +
  `api/admin/impersonate/route.ts` / `exit-impersonation/route.ts`. The
  `kaufnest_impersonating` cookie is read by `DashboardShell` — check that
  component if you rename the cookie.

## Gotchas

- **Platform admin check**: `isPlatformAdmin(email)` (`@/lib/supabase/control`)
  is the single source of truth for "is this user in `control.admin_users`".
  `layout.tsx`, `dashboard/layout.tsx` (sidebar link gating), and each
  `api/admin/*/route.ts`'s local `verifyPlatformAdmin()` all call it — there's
  still no shared *middleware*, so a new admin API route still needs its own
  `verifyPlatformAdmin()` wrapper, but it should call `isPlatformAdmin()`
  rather than re-querying `control.admin_users` directly.
- **`provision_tenant_schema()` is safely re-runnable** for a given
  `schema_name` — section 5 drops existing policies before recreating them
  (see `supabase/SKILL.md`). So if provisioning fails partway through (e.g.
  the Exposed-schemas step or the invite step), just retry "Add Tenant" with
  the same slug — no manual cleanup needed for `policy ... already exists`.
  Step 2's `company_profile` seed also checks for an existing row before
  inserting, so a retry that got past step 2 last time won't leave a duplicate.
- **Exposed schemas is now automated** via `addExposedSchema()`
  (`@/lib/supabase/managementApi`), called right after
  `provision_tenant_schema`. It requires `SUPABASE_ACCESS_TOKEN` (Management
  API personal access token) — if that env var is missing/invalid, provisioning
  fails at this step with a clear error in the `detail` field of the 500
  response. See `src/lib/supabase/SKILL.md`.
- **`generateLink({ type: "magiclink" })`** in `impersonate/route.ts` requires
  `adminEmail` to already be a real user in Project B (created via the invite
  flow) — it does not create a user.
- **Error reporting**: `layout.tsx` wraps the panel in `<ToastProvider>`
  (`@/components/ui/Toast`), so any `_components/*` can call `useToast()`.
  `provision-tenant/route.ts` returns `{ error, detail }` on failure — `detail`
  is the raw Supabase/Postgres message via the local `errorMessage()` helper.
  Always surface `detail` (not just `error`, which is a generic
  "Provisioning failed"), or admins can't tell *why* it failed.
- **`inviteUserByEmail` needs `redirectTo`**: step 5 of `provision-tenant`
  passes `redirectTo: ${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password`
  — without it the invite email's link falls back to the Supabase project's
  Site URL and the new admin never reaches `/set-password`. See
  `src/app/(auth)/SKILL.md` for the full gotcha incl. the `{{ .TokenHash }}`
  email template pattern and the Supabase Dashboard "Redirect URLs" allowlist
  requirement.
- **`adminEmail` reuse across tenants is rejected**: `inviteUserByEmail` does
  NOT error for an email with an existing pending/accepted invite — it
  silently resends and returns that *existing* `auth.users` row (from whatever
  tenant it was last invited into). `provision-tenant` checks
  `inviteData.user.app_metadata?.tenant_schema`; if it's set and differs from
  the new `schemaName`, the whole provisioning throws (surfaced via `detail`)
  instead of inserting a second `profiles` row for that user in the new tenant
  and re-stamping their `tenant_schema` — which would silently move them out of
  their original tenant. Same check exists in `/api/users/invite` (see
  `src/app/dashboard/users/SKILL.md`).
