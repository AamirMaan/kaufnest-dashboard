---
name: auth-feature
description: Work on login, forgot-password, set-password, or the auth callback/invite flow at src/app/(auth) — use when the task mentions sign-in, password reset, invite emails, or session/auth redirects.
---

# Working on the Auth feature

Read `CLAUDE.md` in this folder first — it maps the three in-folder pages plus
the two routes that are part of this flow but can't be colocated (Next.js pins
API/callback routes to fixed URLs that Supabase's email links and redirect
config point at).

## Minimal file set for common changes

- **Login form/UX**: `login/page.tsx`
- **Forgot-password flow**: `forgot-password/page.tsx`
- **Set-password / accept-invite flow**: `set-password/page.tsx` AND
  `src/app/auth/confirm/route.ts` (the redirect that lands users here)
- **Invite email content**: `email-templates/` (project root) — NOT this folder
- **Who can access what after login**: `src/lib/utils/permissions.ts` and
  `src/proxy.ts` — NOT this folder (these pages are intentionally public)

## Test command

No test suite targets these pages — they're thin wrappers over
`supabase.auth.*` calls. If you add logic worth testing, colocate
`*.test.ts` files next to the page (jest picks up any `src/**/*.test.ts`).

## Gotchas

- These pages run with no Redux store and no session yet — use
  `createClient()` from `@/lib/supabase/client` directly, don't reach for
  `useAppSelector`/`useAppDispatch`.
- The Supabase redirect URL (`/auth/confirm`) and the invite/reset email
  templates are configured outside this codebase (Supabase Dashboard) — if you
  change a route path here, that config must be updated too.
- **Email templates use `{{ .TokenHash }}` + `{{ .SiteURL }}`, not
  `{{ .ConfirmationURL }}` or `{{ .RedirectTo }}`**: `email-templates/invite.html`
  and `reset-password.html` link to
  `{{ .SiteURL }}/auth/confirm?next=/set-password&token_hash={{ .TokenHash }}&type=invite`
  (or `type=recovery`) — a link on **our own domain** — instead of
  `{{ .ConfirmationURL }}` (a `*.supabase.co/auth/v1/verify` link).
  `/auth/confirm/route.ts` then calls
  `supabase.auth.verifyOtp({ type, token_hash })`. This is the fix for
  corporate email security scanners that pre-fetch `*.supabase.co` links to
  scan for phishing — that pre-fetch is a *single-use* OTP verify, so it burns
  the token before the real user clicks, producing
  `403: Email link is invalid or has expired` (`otp_expired`) on a never-used
  link (confirmed via `auth.one_time_tokens` having no row for the invited
  user and `email_confirmed_at` never set). See
  https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0.
  Routing through our own domain first removes the `*.supabase.co` link that
  triggers this.
- **Why `{{ .SiteURL }}` instead of `{{ .RedirectTo }}`**: `{{ .RedirectTo }}`
  only renders the actual `redirectTo`/`emailRedirectTo` value if it matches
  an entry in Authentication → URL Configuration → Redirect URLs (wildcards
  supported) — otherwise it silently falls back to the bare Site URL with no
  path, producing a broken link like `https://dashboard.kaufnest.com&token_hash=...`.
  This is a [known open Supabase bug](https://github.com/supabase/supabase/issues/29156)
  even with a correctly wildcarded allow-list entry. `{{ .SiteURL }}` is the
  project's configured Site URL and is **always** rendered (no allow-list
  check), so the templates hardcode the rest of the path
  (`/auth/confirm?next=/set-password`) — safe because both invite and reset
  always land on `/set-password` in this app. The `redirectTo` passed by
  `inviteUserByEmail`/`resetPasswordForEmail` in `/api/users/invite`,
  `/api/admin/provision-tenant`, and `forgot-password/page.tsx` is no longer
  referenced by the templates, but is left in place (harmless) for any future
  flow that does use `{{ .RedirectTo }}`.
- **Local testing caveat**: because the link is built from `{{ .SiteURL }}`,
  invite/reset emails always point at the project's configured Site URL
  (production, `https://dashboard.kaufnest.com`) — not `localhost`. To test
  the full email flow locally, temporarily set Authentication → URL
  Configuration → Site URL to `http://localhost:3000`, trigger the email, then
  change it back.
- `set-password/page.tsx` calls `supabase.auth.refreshSession()` after
  `updateUser` succeeds, before redirecting to `/dashboard` — re-mints the JWT
  so `app_metadata.tenant_schema` (written by `set_user_tenant` during
  provisioning/invite) is present. Without this, `dashboard/layout.tsx`'s
  `createClient()` falls back to the public schema, the `profiles` lookup
  returns no row, and the new user is bounced straight back to `/login`.
