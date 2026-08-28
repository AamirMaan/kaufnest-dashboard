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

- `src/app/auth/confirm/route.ts` — Supabase email links (invite,
  password-reset) point here with `token_hash`+`type` query params; it calls
  `supabase.auth.verifyOtp({ type, token_hash })` to create a session and
  redirects to `/set-password` (or `/dashboard`). Fixed at `/auth/confirm`
  because `email-templates/invite.html`/`reset-password.html` hardcode
  `{{ .SiteURL }}/auth/confirm?next=/set-password&token_hash={{ .TokenHash }}&type=...`
  — can't move without updating both templates in the Supabase Dashboard.
  (Replaces the old `/auth/callback` PKCE `exchangeCodeForSession` route — see
  `(auth)/SKILL.md` for why.)
- `src/app/api/users/invite/route.ts` — server-side half of the invite flow
  (see `dashboard/users/CLAUDE.md`); the email link it triggers lands on
  `set-password` here.
- `src/app/api/admin/provision-tenant/route.ts` — invites a new tenant's
  super_admin (see `src/app/admin/CLAUDE.md`); the invite email's link to
  `set-password` here comes from `email-templates/invite.html`'s `{{ .SiteURL }}`
  path, not the `redirectTo` this route passes (kept harmlessly — see
  `(auth)/SKILL.md`).
- `src/proxy.ts` — route-level access control using `lib/utils/permissions.ts`;
  redirects unauthenticated users to `/login`.

## Shared dependencies

- `lib/supabase/client` (all three pages use the browser client directly —
  no Redux here, these run before any session/store exists)
- `email-templates/` (project root) — the branded invite/reset email HTML sent
  by Supabase, separate from these in-app pages
- `public/brand/boughtopia-icon-bag-mono-light.svg` — referenced directly via
  a plain `<img>` (not the theme-aware `BrandMark` component dashboard/admin
  chrome uses) since `layout.tsx` here hardcodes `bg-slate-950` regardless of
  the app's light/dark theme setting — the white-mono icon is always correct
  here, no switching needed. If this layout's fixed dark background ever
  changes, revisit whether these pages should switch to `BrandMark` instead.

## Tests

No tests target these pages currently (they're thin wrappers over Supabase Auth calls).
