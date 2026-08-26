---
name: messages-feature
description: Agent playbook for the eBay buyer-messaging feature (src/app/dashboard/messages) — minimal file set per change type, gotchas around the unverified Trading API XML schema, ParentMessageID threading, and no-push-sync.
---

# Messages feature playbook

## Minimal file set per change type

- **New field surfaced from eBay** (e.g. an attachment URL): add it to
  `EbayMemberMessage` in `lib/integrations/ebay/messages.ts`'s
  `parseExchangeBlock`, add the DB column via the "2 places" rule
  (`supabase/SKILL.md`) — new migration using `run_on_all_tenant_schemas`
  PLUS `provision_tenant_schema()` — add it to `EbayMessage` in
  `types/index.ts`, and thread it through the sync route's `.upsert()` call
  (`app/api/messages/ebay/sync/route.ts`).
- **Changing thread grouping/ordering**: `_lib/groupThreads.ts` is the single
  source of truth — both `ThreadList` and `page.tsx`'s `replyTarget`
  computation depend on it. Has a colocated test; extend that test alongside
  any behavior change.
- **Supporting `AddMemberMessageAAQToPartner`** (starting a new conversation,
  not just replying — see the CLAUDE.md's "v1 scope" note): would need a new
  function in `lib/integrations/ebay/messages.ts`, a new API route (no
  existing `ebay_messages` row to attach to, so it can't reuse
  `POST /api/messages/[id]/reply`), and a "New message" UI entry point that
  doesn't exist yet — this is a real scope expansion, not a small tweak.

## Gotchas

- **`GetMemberMessages` is scoped to the seller's currently ACTIVE listings
  only — investigating as of 2026-08-26, not yet confirmed against a live
  response.** After the enum fix below made sync succeed, a real sync
  returned 0 messages despite the tenant expecting prior conversation
  history. Cross-referenced against eBay's own docs (via search, since
  developer.ebay.com does not load for this agent — every fetch attempt
  timed out): eBay's own comparison of `GetMemberMessages` vs `GetMyMessages`
  states the former "returns a list of the messages buyers have posted about
  your **active** item listings" — i.e. it is not the general "every message
  this account has" call the header comment at the top of `messages.ts`
  assumed it was, and it structurally cannot see messages tied to sold/ended
  listings **regardless of `StartCreationTime`**. This is a different and
  more fundamental limitation than the 90-day `DEFAULT_LOOKBACK_MS` window
  in `sync/route.ts` — widening that window would not fix it if this is
  right. `GetMyMessages` is the call that mirrors the My eBay Messages web
  UI, but switching (or adding a second source) is unstarted: its
  request/response shape is unparsed here, and whether the `sell.inventory`
  scope this feature reuses even covers it is unverified on top of the
  scope gotcha below. **Do not build a `GetMyMessages` integration on the
  strength of this note alone** — confirm first via the diagnostic log
  below, since a genuinely empty exchange-block count on every sync is the
  only hard evidence this repo can gather without eBay's site loading.
  `fetchMemberMessages` now logs `{ exchangeBlocks, messagesParsed }` per
  page via `console.info` specifically so the next sync settles this: zero
  exchange blocks confirms the scoping theory (or the 90-day window); a
  nonzero count with zero parsed messages instead points at a parsing bug
  in `parseExchangeBlock`, a different fix entirely.
- **`<MessageStatus>All</MessageStatus>` was an invalid enum value and made
  every sync fail (fixed 2026-08-26).** `GetMemberMessages`'s
  `MessageStatus` field is `MessageStatusTypeCodeType`, whose only valid
  values are `Answered`/`Unanswered`/`CustomCode` — verified directly
  against eBay's Trading API reference, not inferred. eBay returned
  `Ack=Failure` on page 1 of every attempt, which the sync route's catch-all
  reported as a bare 502 with no server-side log — the actual cause was only
  visible by reading the response body in the browser Network tab. Confirmed
  this had **never once succeeded**: `ebay_messages` was empty across all 5
  tenant schemas before this fix (checked live). `MailMessageType` still
  legitimately accepts `All` — that field's enum is different from
  `MessageStatus`'s and was never the problem. The element is now omitted
  entirely (optional; omitting it returns both answered and unanswered
  messages, which is what `All` was meant to express).
- **`fetchMemberMessages`'s pagination read the wrong number (fixed
  2026-08-26).** It grabbed the first digit sequence anywhere inside
  `<PaginationResult>`, which also contains `<TotalNumberOfEntries>` — on a
  real account with hundreds of messages, that silently drove the loop by
  the entries count instead of the page count (verified in a test: 500
  entries → 10 fetches instead of 1, hitting `MAX_PAGES`). Now scopes to
  `PaginationResult` and reads `TotalNumberOfPages` specifically, matching
  `listings.ts`'s `fetchActiveListings`. If you touch either function's
  pagination again, keep both reading the same way.
- **The GetMemberMessages XML parsing is still unverified against a live
  response** — the fixes above were request-side (what we send) and
  pagination-side (a self-contained bug), not from ever seeing a real
  response. `lib/integrations/ebay/messages.ts` was written from eBay's
  documented Trading API schema, not tested against a real synced account.
  If `fetchMemberMessages` returns messages with an empty `itemId`/
  `buyerUsername`, or misses messages entirely, the first thing to check is
  whether `<ItemID>` and `<Incoming>`/`<Sender>`/`<RecipientID>` actually
  nest the way `parseExchangeBlock` assumes (comment at the top of that
  file). `parseExchangeBlock` now warns via `console.warn` (with the
  message id) whenever `<Incoming>` is absent on a real message rather than
  silently defaulting it to inbound — check Vercel logs for that warning
  before assuming the parser is right. `tradingApiCall` also now logs the
  raw XML (truncated, no token) to `console.error` on any `Ack=Failure`, so
  once a real sync runs, a raw response is one log line away instead of
  requiring a code change to capture — do the fixture-test step in Phase 3
  of `docs/superpowers/plans/2026-08-26-fix-messages-and-listings.md` once
  one lands.
- **Scope reuse is also still unverified — do not assume the enum fix
  above proves the scope is fine.** Sync had never succeeded even once
  before 2026-08-26, so nothing had reached far enough to distinguish "bad
  enum" from "bad scope"; fixing the enum only rules out the former. This
  feature deliberately reuses the eBay connection's existing
  `sell.inventory` OAuth scope (same one `listings.ts`'s
  `GetMyeBaySelling` uses) rather than adding a new scope to `EBAY_SCOPE`
  in `lib/integrations/ebay.ts` — on the assumption Trading API messaging
  calls work with any valid seller token. If `GetMemberMessages`/
  `AddMemberMessageRTQ` return the token-scope error codes
  (`tradingApi.ts`'s `21916984`/`21917053`/`931`/`932` list), the existing
  "disconnect and reconnect" error message will surface, but reconnecting
  won't actually add a new scope — nothing requests one. If that turns out
  to be needed, the fix is adding to `EBAY_SCOPE`, which invalidates *every*
  existing eBay connection (documented precedent: see the
  `sell.inventory`-not-`.readonly` comment in `ebay.ts`). Treat it as its
  own coordinated task with tenant comms, not a hotfix.
- **A 502 from either API route means eBay itself failed; a 500 means our
  own code (Supabase write, parsing) did (fixed 2026-08-26).** Previously
  both routes caught everything in one block and always returned 502 with
  no server log — a DB write failure was reported to the user as if eBay
  had rejected the call, and nothing was recorded anywhere to diagnose it
  from. `sync/route.ts` and `[id]/reply/route.ts` now log
  `console.error` before every error response, and specifically: in
  `reply/route.ts`, once `replyToMessage` succeeds the reply **has** been
  sent to eBay — a subsequent failure to save it locally is a 500 with
  wording that says the reply went through, so a user doesn't get told
  "Reply failed" and resend a message that already landed. Keep this
  ordering (eBay call → own try/catch, DB write → separate try/catch) if
  you touch either route again.
- **Replies require a `ParentMessageID`.** `POST /api/messages/[id]/reply`
  400s if the target row's `external_message_id` is null — this can only
  happen for a row that was never actually synced from eBay (shouldn't occur
  in practice, since sync is the only inbound-message writer). Outbound rows
  created locally after a successful reply also get `external_message_id:
  null` (eBay's `AddMemberMessageRTQ` has no response payload to read one
  from) — replying to your own outbound row is blocked by
  `ReplyBox`/`latestInboundMessage` always targeting the latest *inbound*
  message in the thread, never an outbound one.
- **No push sync — messages only update when a user clicks "Sync
  messages."** Unlike orders (`api/integrations/review`), there's no
  scheduled/cron sync route in this codebase (see `AGENTS.md`), and eBay's
  Trading API has no webhook for member messages. A buyer's new message
  won't appear until someone opens `/dashboard/messages` and syncs.
- **Reply body is XML-escaped, not the read side.** `escapeXml()`
  (`lib/integrations/ebay/tradingApi.ts`) is applied to `itemId`/
  `parentMessageId`/`recipientUsername`/`body` before building the
  `AddMemberMessageRTQ` request — required since reply text is
  user-supplied free text that could contain `&`/`<`/`>`. The read side
  (`parseExchangeBlock`) only ever calls `decodeXml()`, never needs escaping
  since it's not building a request.
- **Inbound messages fire a notification; outbound replies do not.**
  `notify_message_received` (migration 029, on `ebay_messages`) only inserts
  when `NEW.direction = 'inbound'` — a tenant sending a reply through
  `ReplyBox` never notifies anyone, by design. Its `actor_id` is always
  `NULL` because the actor is an external eBay buyer, not a tenant user;
  `isUnread()` (`src/lib/utils/notifications.ts`) treats a null `actor_id`
  as never matching the "caused by me" suppression rule, so these
  notifications are always eligible to be unread (subject to the normal
  watermark/dismissal checks).
- **The `manage_messages` override now works end to end (fixed by migration
  030).** `notify_message_received` (migration 029) inserts the
  `message.received` row with `visible_to_roles = ['super_admin','admin']`
  AND `required_permission = 'manage_messages'`, so migration 028's
  `notifications_select` policy lets it through for a non-admin who has been
  granted the `manage_messages` override. `ebay_messages_all_admin`
  (migrations 026/027) used to be `current_user_role() IN
  ('admin','super_admin')` with no override branch, so that same user could
  see the bell entry but couldn't read the row it pointed to — a dead-end
  click. Migration 030 redefines `ebay_messages_all_admin` in every tenant
  schema (and `provision_tenant_schema()` in `005_tenant_provisioning.sql`,
  for new tenants) to OR in
  `current_user_has_override('manage_messages')` on both `using` and `with
  check`, so a user granted the override can now read and reply to
  `ebay_messages` rows, not just see that one arrived. If you touch either
  policy, check the other side stays consistent.

## Tests

`npx jest dashboard/messages` (slice + `groupThreads`).
`npx jest lib/integrations/ebay/messages` (XML-parsing fixture test — covers
the `MessageStatus`/pagination/`Incoming`-absent regressions above; all
fixtures are hand-built XML, not a captured real response — see the
still-unverified-parsing gotcha).
`npx jest lib/integrations/ebay/tradingApi` (Ack=Failure logging, token
never logged).
