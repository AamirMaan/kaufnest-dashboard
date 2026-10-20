# lib/dispatch — dispatch email outbox (server-only, 057)

- `processOutbox.ts` (+ test) — pure claim → send → mark loop over injected deps (`processOutbox`), plus `processOutboxUntilDrained(deps, { maxBatches, deadlineMs, now })` which keeps claiming batches while the last one was full.
- `flushOutbox.ts` — wires it to the service-role tenant client + `lib/email/smtp`; budget 5 batches / 20 s per request (route `maxDuration = 60`).
- Route: `src/app/api/dispatch/flush/route.ts` (`requireSectionAccess("orders", 1)`).
- Client nudge: `src/lib/utils/dispatchFlush.ts` (`requestDispatchFlush`), called by `components/layout/DispatchBanner.tsx`.

## Gotchas
- Rows are queued ONLY by the `sales_dispatch_notify` trigger (057). Never insert outbox rows from app code.
- `claim_dispatch_emails` uses `FOR UPDATE SKIP LOCKED` + a 5-minute claim lease, so concurrent flushes never double-send; `attempts < 5` caps retries.
- A failed send (or a throw while building the email) clears `claimed_at` so the next flush retries; a skip (inactive recipient / no Orders access / no email) marks `sent_at` with a `skipped:` note.
- Delivery is **at-least-once**: if `markSent` fails after a successful send, the row stays unsent and is resent after the 5-minute lease expires.
- Stale rows are skipped (`skipped: no longer relevant`): `claim_dispatch_emails` returns `still_relevant` = order still pending/processing AND its CURRENT location's dispatcher is still the recipient (the order may have been shipped, cancelled or moved since queueing). Its TS mirror `ClaimedDispatchEmail` must stay field-for-field in sync with the RPC's RETURNS TABLE.
- Recipients without Orders view are skipped (`skipped: no orders access`): `claim_dispatch_emails` returns `recipient_can_view_orders`, re-checked at claim time via 057's `user_section_level()`. The trigger checks the same rule before queueing.
- Batch size is 10 (`OUTBOX_BATCH_SIZE`); one flush drains up to 5 batches or 20 s (deadline checked before each further claim, so the last batch may run past it). `smtp.ts` is NOT pooled (stale sockets on frozen serverless instances). Email links use `NEXT_PUBLIC_SITE_URL ?? "https://app.boughtopia.com"`, like the invite emails.
- The integrations import route does NOT flush: synced orders are inserted with `product_id: null`, so they never queue at insert time.
