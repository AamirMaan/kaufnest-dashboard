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
