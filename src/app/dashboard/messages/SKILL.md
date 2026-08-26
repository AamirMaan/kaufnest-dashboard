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

- **`parseExchangeBlock`'s wrapper tag and field names — CONFIRMED against a
  real response, fixed 2026-08-26.** A real sync against `tenant_kaufnest`'s
  connected account returned `{ exchangeBlocks: 46, messagesParsed: 0 }` —
  eBay genuinely had 46 conversations reachable by this call (which also
  **disproves**, for this account, the theory that `GetMemberMessages` is
  scoped to active-listing messages only — see the next gotcha), but every
  block failed `parseExchangeBlock`'s `messageId`/`text` guard. A follow-up
  diagnostic logged the real tag names present in one block (never field
  content), which showed the actual shape:

  | Assumed | Real | Note |
  |---|---|---|
  | `<MemberMessage>` wrapper | `<Question>` | ASQ container — `<MemberMessage>` does not appear anywhere in a real response |
  | `Sender` | `SenderID` | |
  | `Text` | `Body` | |
  | `Incoming` | *(doesn't exist)* | see below |
  | `Read` | *(doesn't exist)* — `MessageStatus` (`Answered`/`Unanswered`) is the closest real signal | `isRead = MessageStatus === "Answered"` |
  | `ItemID` sibling of the message | `ItemID` nested under `<Item>` | `tagText` searches the whole block regardless of depth — needed no code change |

  **There is no `<Incoming>` tag because every message this call returns is
  inbound, unconditionally** — eBay's own docs describe `GetMemberMessages`
  as returning only messages buyers have posted, and `AddMemberMessageRTQ`
  (the seller's reply) has no response payload to sync back either; outbound
  rows are written locally by `reply/route.ts` instead, never discovered by
  sync. The old `Incoming`-presence warning and its `incoming ? ... :`
  branching are gone — `direction` is always `"inbound"` here.

  The `console.warn` schema-mismatch diagnostic from the investigation is
  kept permanently (not removed post-fix) as defense-in-depth: it now checks
  for `<Question>` specifically, so if eBay changes this shape again, the
  next sync's logs will say so instead of silently zeroing out results the
  same way this did. **Still outstanding**: capture a redacted real response
  as a fixture (Phase 3 of
  `docs/superpowers/plans/2026-08-26-fix-messages-and-listings.md`) so this
  exact class of drift can't silently regress again — the current tests use
  hand-built fixtures matching the confirmed shape, not a captured response.
- **`GetMemberMessages` may still be scoped to active listings for OTHER
  accounts.** The theory (`GetMemberMessages` "returns messages buyers have
  posted about your **active** item listings", per eBay's own comparison
  with `GetMyMessages` — via search, since developer.ebay.com does not load
  for this agent on any fetch attempt) is disproven for the account tested
  above (46 real exchange blocks came back), but that doesn't make the claim
  false in general — it may just mean those 46 conversations happen to be
  about currently-active listings. If a tenant reports a message count that
  still feels low against what they expect, revisit this before assuming
  the parser (now fixed) is the problem again.
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
- **The GetMemberMessages XML parsing is now verified against a live
  response (2026-08-26)** — see the wrapper-tag/field-name gotcha above for
  the confirmed shape and what changed. `tradingApiCall` still logs the raw
  XML (truncated, no token) to `console.error` on any `Ack=Failure`, and
  `fetchMemberMessages` logs `{ exchangeBlocks, messagesParsed }` per page
  plus a schema-mismatch warning if parsing ever drops a block again — both
  kept permanently, not just for this investigation.
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
