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
  `src/app/auth/callback/route.ts` (the redirect that lands users here)
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
- The Supabase redirect URL (`/auth/callback`) and the invite/reset email
  templates are configured outside this codebase (Supabase Dashboard) — if you
  change a route path here, that config must be updated too.
