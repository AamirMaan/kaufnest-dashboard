# Users feature

Route: `/dashboard/users`. Super-admin-only user management: invite new users,
edit profile/role, change roles (`super_admin`, `admin`, `accountant`), grant
per-user permission overrides beyond the role's defaults, and
deactivate/reactivate a user's dashboard access.

## Files in this folder

- `page.tsx` — list view, role + status badges, wires up the modals below.
  Gated to `super_admin` (see `lib/utils/permissions.ts`). Client-side
  pagination via local `page`/`pageSize` state (default 25 rows/page) slicing
  `state.users.items`; renders `<Pagination>` (`@/components/ui/Pagination`)
  below the `DataTable`. Row actions: Edit (`EditUserModal`), Manage
  permissions (`PermissionsModal`, `ShieldCheck` icon), Resend invite,
  Deactivate/Reactivate (`UserX`/`UserCheck` icon, toggles based on
  `p.status`) — see "Deactivate/reactivate" below.
- `_store/usersSlice.ts` — Redux slice for `state.users` (`items`, `loaded`).
  Actions: `hydrateUsers`, `addUser`, `updateUser`, `updateUserRole`. Used
  **only** by this feature — registered centrally in `src/store/store.ts` and
  hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/usersSlice.test.ts` — reducer tests. Run with `npx jest dashboard/users`.
- `_lib/userStatusGuards.ts` (+ colocated test) — pure `canDeactivateUser(target,
  currentUserId, allUsers)` helper. Blocks deactivating an already-deactivated
  user, deactivating your own account, or deactivating the last remaining
  active `super_admin`. `page.tsx` uses this to disable the Deactivate button
  (with the block reason as its `title` tooltip) rather than letting the
  write fail server-side.
- `_components/InviteUserModal.tsx` — sends an invite (calls the API route below),
  then dispatches `addUser`.
- `_components/EditUserModal.tsx` — edits profile fields and/or role, dispatches `updateUser`.
- `_components/PermissionsModal.tsx` — checklist of every `Permission` (from
  `lib/utils/permissions.ts`, grouped by area: Orders/Expenses/Purchases/
  Users/Reporting/Platform integrations), grouped into `PERMISSION_GROUPS`
  (defined locally in this file). Permissions already granted by the user's
  role render checked + disabled (`hasPermission(user.role, permission)` with
  no overrides arg); everything else is a toggle. Writes the full
  `permission_overrides` array straight to `profiles.permission_overrides`,
  dispatches `updateUser` (reused from `usersSlice`, not a dedicated action —
  it's a full-profile replace like `EditUserModal`), and audit-logs with
  action `permission_change`.

## Deactivate/reactivate (revoke access, never a hard delete)

- `Profile.status: "active" | "deactivated"` (`profiles.status`, see
  `supabase/migrations/025_user_status.sql`) — deliberately NOT a delete.
  `sales`/`expenses`/`purchases`/`ebay_listing_drafts` all have a NOT NULL
  `created_by REFERENCES profiles(id)` with no cascade, so hard-deleting any
  profile that's ever created a record throws a foreign-key error. Mirrors
  the existing whole-tenant deactivation pattern
  (`control.tenants.status`, gated in `src/proxy.ts`) at the per-user level.
- `page.tsx`'s Deactivate button opens the shared `DeleteConfirmModal`
  (`components/modals/DeleteConfirmModal`, relabeled via its
  `confirmLabel`/`reasonLabel` props — see that component's own note) and
  requires a reason. Reactivate is a single click, no modal, no reason
  (mirrors Resend Invite's "low-friction, easily reversible" treatment).
  Both go through the same local `writeStatusChange()` helper in `page.tsx`:
  write `profiles.status`, dispatch `updateUser`, `writeAuditLog` with action
  `status_change` (metadata `{ from, to, target_email, reason? }`), dispatch
  `addAuditLog`.
- **`src/proxy.ts`** is what actually enforces this — it fetches
  `role, status, permission_overrides` in one query now (previously just
  `role, permission_overrides`) and redirects to `/account-suspended` when
  `status === "deactivated"`, before the RBAC check. A deactivated user can
  still authenticate with Supabase (proxy can't intercept that client-side
  call, same as tenant-level deactivation) but is bounced out of every
  `/dashboard/*` route immediately after.
- `src/app/account-suspended/page.tsx` — the page they land on. Distinct from
  `src/app/account-deactivated/page.tsx` (whole-tenant deactivation) so the
  messaging is accurate ("a super admin on your team" vs. "your organisation").

## Related files outside this folder (cannot be colocated)

- `src/app/api/users/invite/route.ts` — server route that creates the
  Supabase Auth user and profile row for an invite. Next.js requires API routes
  to live at their URL path (`/api/users/invite`), so it can't move into this
  feature's private folder — but it is conceptually part of this feature.
  `InviteUserModal` calls it via `fetch("/api/users/invite")`.
  Tenant-aware: reads the calling super_admin's `tenant_schema` from
  `user.app_metadata`, inserts the new user's profile directly into
  `tenant_<schema>.profiles` via `createServiceClientForTenant()`, and stamps
  the invitee's own `app_metadata.tenant_schema` via the `set_user_tenant` RPC
  (`public.handle_new_user` no longer auto-creates profile rows — dropped in
  step 5 of `supabase/migrations/006_bootstrap_tenant_kaufnest.sql`).
  Before inviting, it rejects (409) if `email` already has a `profiles` row in
  this tenant, or already belongs to a different tenant — see the
  duplicate-email gotcha in `SKILL.md`.

- `src/app/api/users/resend-invite/route.ts` — server route that resends an
  invite for an existing user whose link has expired. Calls
  `adminClient.auth.admin.inviteUserByEmail` again (Supabase resends the invite
  email for users with a pending invite) using the existing profile's
  `full_name`/`role` from `tenant_<schema>.profiles`. Does **not** create a
  profile row (already exists) and does **not** call `set_user_tenant` RPC
  (already stamped). Returns 404 if the email has no profile in this tenant.
  `page.tsx` calls it inline via `fetch("/api/users/resend-invite")` — no modal.

## Data flow

1. Invite: `InviteUserModal` POSTs to `/api/users/invite` (uses the Supabase
   admin client server-side), then dispatches `addUser` with the returned profile.
2. Resend invite: `page.tsx` POSTs to `/api/users/resend-invite` with `{ email }`;
   no Redux dispatch needed (profile row unchanged). Shows a toast on success/error.
3. Edit/role-change: write to Supabase (`profiles` table) via
   `await createTenantClient()` (`@/lib/supabase/client`), dispatch `updateUser`/`updateUserRole`.
4. Permissions: `PermissionsModal` writes `profiles.permission_overrides`
   (jsonb array of `Permission` keys) the same way, dispatches `updateUser`.
5. Deactivate/reactivate: `page.tsx`'s `writeStatusChange()` writes
   `profiles.status` the same way, dispatches `updateUser`.
6. All of invite/role-change/permission-change/status-change call
   `writeAuditLog` (`@/lib/utils/audit`) then dispatch `addAuditLog`
   (`@/store/slices/auditLogsSlice`) — role changes use the `role_change`
   audit action, permission changes use `permission_change`, status changes
   use `status_change`, resend uses `resend_invite`.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Button`, `DataTable`, `Badge` (`RoleBadge`, `StatusBadge`), `Pagination`, `FormFields` (`Checkbox`)
- `components/modals/DeleteConfirmModal` — reused for the Deactivate
  confirmation (relabeled via props); NOT shared-with-Sales/Expenses/
  Purchases in the sense of touching the same data, just the same component
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state
- `lib/utils/{audit,date,permissions}` — `permissions.ts` supplies
  `hasPermission`, `ALL_PERMISSIONS`/`PERMISSION_LABELS` (used by
  `PermissionsModal`)
- `types` (`Profile`, `UserRole`, `UserStatus`)

## Permission overrides (additive per-user grants)

- `Profile.permission_overrides: string[]` — a jsonb array column on
  `profiles` (see `supabase/migrations/023_user_permission_overrides.sql`),
  ADDITIVE ONLY: a super_admin can grant a specific user an extra `Permission`
  key beyond their role's defaults (e.g. give one accountant `delete_sale`),
  but an override can never remove something the role already grants.
  `hasPermission(role, permission, overrides)` in `lib/utils/permissions.ts`
  is the single combining function — always pass the profile's
  `permission_overrides` where available rather than checking role alone.
- `delete_sale`/`delete_expense`/`delete_purchase` overrides are additionally
  enforced in Postgres RLS (those three DELETE policies were role-only, not
  app-code-gated) via `{{schema}}.current_user_has_override(perm)` — see the
  migration's header comment. Every other permission in the matrix is only
  ever checked in application code, so no RLS change was needed for those.

## Tests

`npx jest dashboard/users` runs `_store/usersSlice.test.ts` and
`_lib/userStatusGuards.test.ts`.
