# lib/dispatch — dispatch email outbox (server-only, 057)

- `processOutbox.ts` (+ test) — pure claim → send → mark loop over injected deps.
- `flushOutbox.ts` — wires it to the service-role tenant client + `lib/email/smtp`.
- Route: `src/app/api/dispatch/flush/route.ts` (`requireSectionAccess("orders", 1)`).
- Client nudge: `src/lib/utils/dispatchFlush.ts` (`requestDispatchFlush`), called by `components/layout/DispatchBanner.tsx`.

## Gotchas
- Rows are queued ONLY by the `sales_dispatch_notify` trigger (057). Never insert outbox rows from app code.
- `claim_dispatch_emails` uses `FOR UPDATE SKIP LOCKED` + a 5-minute claim lease, so concurrent flushes never double-send; `attempts < 5` caps retries.
- A failed send (or a throw while building the email) clears `claimed_at` so the next flush retries; a skip (inactive recipient / no Orders access / no email) marks `sent_at` with a `skipped:` note.
- Delivery is **at-least-once**: if `markSent` fails after a successful send, the row stays unsent and is resent after the 5-minute lease expires.
- Recipients without Orders view are skipped (`skipped: no orders access`): `claim_dispatch_emails` returns `recipient_can_view_orders`, re-checked at claim time via 057's `user_section_level()`. The trigger checks the same rule before queueing.
- Default batch is 10 (`processOutbox(deps, limit = 10)`); `smtp.ts` uses `pool: true`. Email links use `NEXT_PUBLIC_SITE_URL ?? "https://app.boughtopia.com"`, like the invite emails.
- The integrations import route does NOT flush: synced orders are inserted with `product_id: null`, so they never queue at insert time.
