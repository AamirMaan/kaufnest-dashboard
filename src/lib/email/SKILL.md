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
