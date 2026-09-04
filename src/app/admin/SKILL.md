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
- **Edit an existing tenant** (plan, status, admin email):
  `_components/EditTenantModal.tsx` (form) + `api/admin/tenants/[id]/route.ts`
  (backend). `_components/TenantDetailActions.tsx` and
  `tenants/[id]/page.tsx` are already wired — only touch them if you need to
  change the button layout or refresh behaviour. (2026-09-03: action buttons
  moved off the main table onto the per-tenant detail page — see
  `CLAUDE.md`.)
- **Change impersonation**: `_components/TenantDetailActions.tsx` +
  `api/admin/impersonate/route.ts` / `exit-impersonation/route.ts`. The
  confirmation dialog is a `ConfirmActionModal`, not `window.confirm()` — see
  the gotcha below before reaching for `DeleteConfirmModal` instead. The
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
- **Invite email link is built from `{{ .SiteURL }}`, not `redirectTo`**: step
  5 of `provision-tenant` still passes
  `redirectTo: ${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password` to
  `inviteUserByEmail`, but `email-templates/invite.html` builds the actual link
  as `{{ .SiteURL }}/auth/confirm?next=/set-password&token_hash={{ .TokenHash }}&type=invite`
  — `redirectTo` is no longer referenced by the template (left in place
  harmlessly). See `src/app/(auth)/SKILL.md` for the full `{{ .TokenHash }}` /
  `{{ .SiteURL }}` email template pattern and why `{{ .RedirectTo }}` was
  dropped.
- **`auth.admin.listUsers()` to find by email**: The Supabase JS admin API has
  no `getUserByEmail` — `listUsers()` returns all users as an array, filter
  client-side by `.find(u => u.email === oldEmail)`. Acceptable at this user
  count; if the tenant base grows large, replace with a direct `auth.users`
  table query via service role.
- **Plan/status edit bypasses Stripe**: `PATCH /api/admin/tenants/[id]` writes
  `plan` and `status` directly to `control.tenants` without touching Stripe.
  It's a manual admin override. Stripe webhooks continue to be the
  authoritative writer for production billing events.
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
- **`ConfirmActionModal` vs. the shared `DeleteConfirmModal`**: this folder's
  `_components/ConfirmActionModal.tsx` is a plain yes/no confirm (Toggle AI,
  Impersonate) — no reason field. `src/components/modals/DeleteConfirmModal.tsx`
  (shared with Sales/Expenses/Purchases) forces a typed reason and is scoped
  to delete-style flows; `DeleteTenantModal.tsx` in this folder uses a
  type-the-schema-name confirmation instead of either, since dropping a
  tenant schema is destructive enough to warrant more friction than a typed
  reason would add. Don't reach for `DeleteConfirmModal` for a new
  non-destructive admin-panel confirmation — use `ConfirmActionModal`.
