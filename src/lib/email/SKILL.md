# lib/email — transactional email (server-only)

- `smtp.ts` — nodemailer transport from `SMTP_*` env; `isSmtpConfigured()`, `sendMail()`.
- `dispatchEmail.ts` (+ test) — pure `buildDispatchEmail()` for dispatch notifications (057).

## Adding an email
1. Pure builder `<name>Email.ts` returning `{ subject, html, text }`, every value through `escapeHtml`, colocated test.
2. Send via `sendMail()` from server code only.

## Gotchas
- Never import from a `"use client"` file (verifier blocks it; env vars are server-only).
- `secure` is derived from port 465; 587 uses STARTTLS.
- Callers must check `isSmtpConfigured()` and no-op, so dev without SMTP never errors.
- The transport is cached per server instance but deliberately **not pooled** (no `pool: true`): on Vercel a frozen instance keeps a pooled socket that is dead on thaw. One connection per message is fine at this volume.
- `connectionTimeout`/`greetingTimeout` 10 s and `socketTimeout` 20 s: nodemailer's defaults (up to minutes) could hold a route past its `maxDuration`. A timeout surfaces as a normal send failure.
