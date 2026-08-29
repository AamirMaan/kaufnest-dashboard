# Email templates

These files are **not** loaded by the app. They are pasted by hand into
Supabase Dashboard → Authentication → Email Templates, which is the only
place they take effect. Keep this directory in sync with what is live there.

| File | Supabase template | Notes |
| --- | --- | --- |
| `invite.html` | Invite user | Admin-provisioned tenants (`/admin` → Add Tenant) |
| `reset-password.html` | Reset password | |
| `confirm-signup.html` | Confirm signup | Self-serve signup (2026-08-28). **Requires email confirmations to be enabled** under Authentication → Providers → Email, or `signUp()` returns a live session and the whole deferred-provisioning guarantee is lost. |

All of them link to `{{ .SiteURL }}/auth/confirm?...` rather than Supabase's
own `{{ .ConfirmationURL }}` — corporate email scanners pre-fetch
`*.supabase.co` verify links and burn the single-use token before the real
user clicks. See `src/app/auth/confirm/route.ts`.
