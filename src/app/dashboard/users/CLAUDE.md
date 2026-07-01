# Users feature

Route: `/dashboard/users`. Super-admin-only user management: invite new users,
edit profile/role, change roles (`super_admin`, `admin`, `accountant`).

## Files in this folder

- `page.tsx` — list view, role badges, wires up the modals below. Gated to
  `super_admin` (see `lib/utils/permissions.ts`).
- `_store/usersSlice.ts` — Redux slice for `state.users` (`items`, `loaded`).
  Actions: `hydrateUsers`, `addUser`, `updateUser`, `updateUserRole`. Used
  **only** by this feature — registered centrally in `src/store/store.ts` and
  hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/usersSlice.test.ts` — reducer tests. Run with `npx jest dashboard/users`.
- `_components/InviteUserModal.tsx` — sends an invite (calls the API route below),
  then dispatches `addUser`.
- `_components/EditUserModal.tsx` — edits profile fields and/or role, dispatches `updateUser`.

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
4. Both invite and role-change call `writeAuditLog` (`@/lib/utils/audit`) then
   dispatch `addAuditLog` (`@/store/slices/auditLogsSlice`) — role changes use
   the `role_change` audit action; resend uses `resend_invite`.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Button`, `DataTable`, `Badge` (`RoleBadge`)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state
- `lib/utils/{audit,date,permissions}`
- `types` (`Profile`, `UserRole`)

## Tests

`npx jest dashboard/users` runs `_store/usersSlice.test.ts`.
