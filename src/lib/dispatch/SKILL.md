# lib/dispatch — dispatch email outbox (server-only, 057)

- `processOutbox.ts` (+ test) — pure claim → send → mark loop over injected deps.
- `flushOutbox.ts` — wires it to the service-role tenant client + `lib/email/smtp`.
- Route: `src/app/api/dispatch/flush/route.ts` (`requireSectionAccess("orders", 1)`).
- Client nudge: `src/lib/utils/dispatchFlush.ts` (`requestDispatchFlush`), called by `components/layout/DispatchBanner.tsx`.

## Gotchas
- Rows are queued ONLY by the `sales_dispatch_notify` trigger (057). Never insert outbox rows from app code.
- `claim_dispatch_emails` uses `FOR UPDATE SKIP LOCKED` + a 5-minute claim lease, so concurrent flushes never double-send; `attempts < 5` caps retries.
- A failed send clears `claimed_at` so the next flush retries; a skip (inactive recipient / no email) marks `sent_at` with a `skipped:` note.
- The integrations import route does NOT flush: synced orders are inserted with `product_id: null`, so they never queue at insert time.
