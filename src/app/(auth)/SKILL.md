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
- **Every `inviteUserByEmail`/`resetPasswordForEmail` call must pass
  `redirectTo: ${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password`**
  (both `/api/users/invite` and `/api/admin/provision-tenant` do this). Without
  it, `{{ .RedirectTo }}` in the email template (see next gotcha) falls back
  to the project's Site URL, `verifyOtp` redirects there instead of
  `/auth/confirm`, and the invited user lands with no session and no path to
  `/set-password`.
- **Email templates use `{{ .TokenHash }}` + `{{ .RedirectTo }}`, not
  `{{ .ConfirmationURL }}`**: `email-templates/invite.html` and
  `reset-password.html` link to
  `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite` (or
  `type=recovery`) — a link on **our own domain** — instead of
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
- **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**
  must also include `<NEXT_PUBLIC_SITE_URL>/auth/confirm**` (wildcard) — if
  `redirectTo` doesn't match an allow-listed pattern, `{{ .RedirectTo }}` in
  the email template falls back to Site URL with the same broken result. For
  local testing of invite/reset emails, add
  `http://localhost:3000/auth/confirm**` too and temporarily set
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000` in `.env.local` (email links are
  built from this env var, not the request origin).
- `set-password/page.tsx` calls `supabase.auth.refreshSession()` after
  `updateUser` succeeds, before redirecting to `/dashboard` — re-mints the JWT
  so `app_metadata.tenant_schema` (written by `set_user_tenant` during
  provisioning/invite) is present. Without this, `dashboard/layout.tsx`'s
  `createClient()` falls back to the public schema, the `profiles` lookup
  returns no row, and the new user is bounced straight back to `/login`.
