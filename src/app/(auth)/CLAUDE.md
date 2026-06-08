# Auth feature

Route group `(auth)` — public, unauthenticated pages, all sharing a centered
card layout (`layout.tsx`). No feature-private components, slices, or tests:
each page is a self-contained Supabase Auth form.

## Files in this folder

- `layout.tsx` — shared centered-card shell for all auth pages.
- `login/page.tsx` — email/password sign-in (`supabase.auth.signInWithPassword`).
- `forgot-password/page.tsx` — sends a password-reset email
  (`supabase.auth.resetPasswordForEmail`).
- `set-password/page.tsx` — lets an invited user (or someone resetting their
  password) set a new password after following the email link
  (`supabase.auth.updateUser`).

## Related files outside this folder (cannot be colocated)

- `src/app/auth/callback/route.ts` — Supabase redirects here after an invite
  or password-reset email link is clicked; it exchanges the PKCE `code` for a
  session and redirects to `/set-password` (or `/dashboard`). Fixed at
  `/auth/callback` by Supabase's "Redirect URL" config — can't move.
- `src/app/api/users/invite/route.ts` — server-side half of the invite flow
  (see `dashboard/users/CLAUDE.md`); the email link it triggers lands on
  `set-password` here.
- `src/proxy.ts` — route-level access control using `lib/utils/permissions.ts`;
  redirects unauthenticated users to `/login`.

## Shared dependencies

- `lib/supabase/client` (all three pages use the browser client directly —
  no Redux here, these run before any session/store exists)
- `email-templates/` (project root) — the branded invite/reset email HTML sent
  by Supabase, separate from these in-app pages

## Tests

No tests target these pages currently (they're thin wrappers over Supabase Auth calls).
