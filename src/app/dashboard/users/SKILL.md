---
name: users-feature
description: Work on the Users dashboard feature (invite users, edit profiles, change roles) at src/app/dashboard/users plus its API route — use when the task mentions user management, invites, roles, permissions UI, or the /dashboard/users route.
---

# Working on the Users feature

This feature is mostly colocated under `src/app/dashboard/users/`. Read
`CLAUDE.md` in this folder first — it explains the file map, including the one
file that *can't* be colocated (the invite API route, which Next.js pins to
`/api/users/invite`).

## Minimal file set for common changes

- **Invite flow / invite form fields**: `_components/InviteUserModal.tsx` AND
  `src/app/api/users/invite/route.ts` (the server-side half of the flow).
- **Edit profile / change role UI**: `_components/EditUserModal.tsx`.
- **Add a field to a user profile**: `src/types/index.ts` (`Profile`), both
  modals above, `_store/usersSlice.ts` only if the Redux shape changes, and
  `page.tsx` if it should render in the table.
- **Role/permission rules**: `src/lib/utils/permissions.ts` (shared — also
  drives route access in `src/proxy.ts`), not this folder.

## Test command

`npx jest dashboard/users`

## Gotchas

- `usersSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` via the `@/app/dashboard/users/_store/usersSlice`
  alias — update those if you rename the slice file.
- This page is gated to `super_admin` — check `lib/utils/permissions.ts` and
  `s.currentUser.profile?.role` checks before changing access logic.
- Role changes must go through `writeAuditLog` with action `role_change` —
  this is the audit trail super-admins rely on to review who changed what.
- `src/app/api/users/invite/route.ts` invites users into the **caller's own**
  tenant (`user.app_metadata.tenant_schema`) — it 400s with a friendly message
  if that's missing (stale JWT from before Phase 2.3 stamping; user needs to
  re-login). It writes the new profile via `createServiceClientForTenant()`,
  not a plain `public`-schema client — there is no `handle_new_user` trigger
  to fall back on anymore.
- If invited users report they can't set a password / can't log in after
  accepting the invite, the `redirectTo` this route passes to
  `inviteUserByEmail` (`${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password`)
  is no longer what builds the email link — check the Supabase Dashboard
  (Authentication → Email Templates → "Invite user") instead: the link must be
  `{{ .SiteURL }}/auth/confirm?next=/set-password&token_hash={{ .TokenHash }}&type=invite`,
  not `{{ .ConfirmationURL }}` or `{{ .RedirectTo }}` (the latter is a known
  Supabase bug that falls back to a bare, broken Site URL — see the gotchas in
  `src/app/(auth)/SKILL.md` for the full invite→set-password→login chain and
  what to check).
- **Duplicate-email guard**: `inviteUserByEmail` does NOT error for an email
  that already has a pending (unconfirmed) invite — it silently resends and
  returns the *existing* `auth.users` row. Before calling it, the route now
  checks `tenant_<schema>.profiles` for that email (`.ilike`) and 409s with "A
  user with this email already exists in this team." if found. After the
  invite call, it also checks `inviteData.user.app_metadata?.tenant_schema` —
  if the returned user already belongs to a *different* tenant, it 409s with
  "This email is already associated with another organization." instead of
  inserting a second `profiles` row and re-stamping `tenant_schema` to this
  tenant (which would silently move that user out of their original tenant).
  `usersSlice.addUser` also dedupes by `id` as a second line of defense.
