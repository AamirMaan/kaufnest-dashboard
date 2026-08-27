---
name: messages-feature
description: Agent playbook for the eBay buyer-messaging feature (src/app/dashboard/messages) — minimal file set per change type, gotchas around the unverified Trading API XML schema, ParentMessageID threading, and no-push-sync.
---

# Messages feature playbook

## Minimal file set per change type

- **New field surfaced from eBay** (e.g. an attachment URL — the
  `item_title`/`item_price`/`item_currency`/`item_url` fields added
  2026-08-27 by migration `034` are the reference example, worth reading
  before repeating this): add it to `EbayMemberMessage` in
  `lib/integrations/ebay/messages.ts`'s `parseExchangeBlock`, add the DB
  column via the "2 places" rule (`supabase/SKILL.md`) — new migration
  using `run_on_all_tenant_schemas` PLUS `provision_tenant_schema()` — add
  it to `EbayMessage` in `types/index.ts`, and thread it through the sync
  route's `.upsert()` call (`app/api/messages/ebay/sync/route.ts`).
  **If the field is something `groupThreads.ts` reads from "the most recent
  message" (like the item-details header does), also copy it onto the
  reply route's `.insert()`** (`app/api/messages/[id]/reply/route.ts`,
  already done for `item_id`/`buyer_username`) — otherwise the very next
  reply a user sends becomes the thread's newest message, and its blank
  field silently overwrites what synced messages had, since a
  locally-created outbound row has no `<Item>`/exchange XML of its own to
  read the field from. This is exactly the shape of bug that would only
  show up after shipping, when someone actually replies — caught here by
  tracing `groupThreads.ts`'s "last message wins" logic forward rather than
  waiting for it to be reported.
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
- **Changing the auto-sync trigger or cadence**: `page.tsx`'s `runSync` +
  the `useEffect` that calls it on mount is the only place this lives — no
  slice/thunk changes needed for a cadence tweak (e.g. throttling), just
  the effect's condition. **Adding avatar colors or changing bubble/unread
  styling**: `_lib/avatarColor.ts` (colors) and `_components/ThreadView.tsx`
  / `_components/ThreadList.tsx` (layout) — see the Tailwind-static-strings
  gotcha below before touching `avatarColor.ts`.
- **Changing infinite-scroll behavior** (threshold, page size): the scroll
  listener and its `150px` threshold live entirely in
  `_components/ThreadList.tsx` (`LOAD_MORE_THRESHOLD_PX`); the
  replace-vs-append decision lives in `messagesSlice.ts`'s
  `fetchMessagesPage.fulfilled` (`page === 1` ? replace : append). Both need
  to change together if you ever want e.g. "append on page 1 too."
  **Changing search** (scope, result cap, debounce): `messagesSlice.ts`'s
  `searchMessages` thunk (`SEARCH_RESULT_LIMIT`, the `.or(...)` filter
  columns) and `page.tsx`'s `SEARCH_DEBOUNCE_MS`.

## Gotchas

- **A sent reply could vanish from the UI until the next real fetch — a
  slow background sync racing a fast local mutation, fixed 2026-08-27.**
  `page.tsx`'s auto-sync (`runSync`) fires on every page visit and calls a
  live eBay API (`syncMessages()`, can take a few seconds) before refetching
  page 1. The `ReplyBox` is never disabled while that's in flight — nothing
  gates it on `isSyncing`. If a user opens a thread and replies while that
  auto-sync is still running, `sendReply.fulfilled` unshifts the new
  outbound row into `items` immediately (correct), but the *slower*,
  already-in-flight `fetchMessagesPage({ page: 1 })` from `runSync` can then
  resolve with a snapshot queried **before** the reply was inserted — and its
  `.fulfilled` case used to blindly `state.items = data`, replacing the
  array and silently erasing the just-sent reply until the next fetch
  (manual refresh, or the layout's next server-side hydration) picked it up
  fresh. Fixed by merging page-1 responses by id instead of replacing (see
  the `messagesSlice.ts` bullet in CLAUDE.md) — fresh rows win, anything
  present only locally survives. **If you ever add another "background
  refresh replaces local state" pattern to this feature, ask whether a
  user-initiated mutation could be in flight at the same time** — a
  REPLACE-based reducer case is only safe when nothing else can be adding
  rows to that same array concurrently.
- **`<CreationDate>` and `<MessageStatus>` are siblings of `<Question>`, not
  nested inside it — CONFIRMED live 2026-08-27, fixed.** A one-time
  diagnostic (`redactedStructure()`, since removed — its job was done)
  logged a fully redacted tag skeleton of a real exchange block, which
  showed:
  ```
  <MemberMessageExchange><Item>…</Item><Question>…</Question><MessageStatus>…</MessageStatus><CreationDate>…</CreationDate><LastModifiedDate>…</LastModifiedDate></MemberMessageExchange>
  ```
  Both fields live at the `<MemberMessageExchange>` level, alongside
  `<Question>`, not inside it. Reading them via `tagText(block, ...)` (where
  `block` is the `<Question>...</Question>` substring) always returned
  `null` — silently, since `parseExchangeBlock`'s message-id/body guard
  still passed. Confirmed the blast radius via direct DB query before
  fixing: **every** synced row (not just repeats within one thread) had
  `ebay_created_at` within milliseconds of its sync time, and `is_read` was
  `false` on all 46 rows. `parseExchangeBlock` now reads `creationDate`/
  `messageStatus` once from `exchangeXml` (same place `itemTitle`/
  `itemPrice`/`itemUrl` were already read from), not from the per-message
  `block`.
  - **Self-poisoning consequence, worth knowing if this class of bug ever
    recurs**: `sync/route.ts` computes its `since` cursor as
    `MAX(ebay_created_at)` from what's already stored. Because every
    existing row had `ebay_created_at ≈ now`, the very next sync's `since`
    became "basically now," and eBay correctly returned zero exchange
    blocks — which also meant the diagnostic couldn't produce a sample to
    log, since it only fires when at least one exchange block comes back.
    Broke the loop with a one-off `UPDATE tenant_kaufnest.ebay_messages SET
    ebay_created_at = now() - interval '90 days' WHERE direction =
    'inbound'` (run manually against Project B, not a migration) to reset
    the cursor back to the same 90-day `DEFAULT_LOOKBACK_MS` fallback that
    found these messages the first time. **After deploying this fix, the
    same reset is needed once more** before the corrected parser can
    re-fetch and correctly overwrite these rows' `ebay_created_at` — the
    last (pre-fix) sync ran with the still-broken parser and re-poisoned the
    cursor again. One more sync after that reset should self-heal
    permanently, since real historical timestamps stop drifting toward
    "now" once parsing is correct.
- **`--color-surface-hover` does not exist anywhere in `globals.css` — was
  never a real token, fixed 2026-08-27.** Both `ThreadList.tsx` (the row
  hover state) and `ThreadView.tsx` (the original inbound-answered bubble
  background, pre-dating the 2026-08-26 redesign) referenced it. An
  undefined CSS custom property with no fallback makes the declaration
  invalid at computed-value time — `background-color` silently reverts to
  its initial value (`transparent`), not to any visible color. Every
  inbound-answered bubble had a fully transparent background this whole
  time; the row hover state simply did nothing. Both now use
  `--color-surface-subtle`, this app's actual established token for a
  subtle hover/alternate background (see `components/ui/Button.tsx`,
  `components/ui/DataTable.tsx`, `listings/_components/CategoryStep.tsx`
  for the same pattern elsewhere). **If a bubble/row background looks like
  it's doing nothing, check the custom property genuinely exists in
  `globals.css` before assuming the Tailwind class or theme logic is
  wrong** — Tailwind will happily emit a rule for `bg-(--anything)` whether
  or not that variable is ever defined.
- **A subtler variant of the same class of bug: answered inbound bubbles
  used `bg-(--color-surface-subtle)`, a token that DOES exist, but is the
  exact same value as the page's own `--background`
  (`globals.css`: `--background: var(--color-surface-subtle)`) — fixed
  2026-08-27.** No CSS bug this time, just the wrong token: the bubble was
  painted the identical color as what's behind it, so it read as "no skin
  around the message" (reported with a screenshot showing some bubbles —
  the amber unread ones — with a visible fill, others with none). Fixed to
  `bg-(--color-surface)` + `style={{ boxShadow: "var(--shadow-card)" }}`,
  the same white-card-on-subtle-page-background treatment
  `StatCard`/`DataTable` use elsewhere in this app. **Lesson**: when
  checking "does this token exist," also check "is this token
  *distinguishable* from whatever's underneath it" — existing in
  `globals.css` doesn't guarantee a token renders visibly in every context
  it's used.
- **The sync upsert's `ON CONFLICT` target was a PARTIAL index — fixed in
  migration `033_ebay_messages_full_unique_index.sql`, confirmed live
  2026-08-27.** Once parsing was fixed (next gotcha), sync got past
  `fetchMemberMessages` cleanly (`{ exchangeBlocks: 46, messagesParsed: 46 }`
  in the logs) and failed one step later, at the Supabase write, with the
  route's deliberately generic `{ error: "Failed to save synced messages" }`
  (a raw Postgres error is never shown to the client — see the 502-vs-500
  gotcha below). The real cause, from `console.error` server-side: `026`
  created `idx_ebay_messages_external_id` as **partial**
  (`WHERE external_message_id IS NOT NULL`), but `sync/route.ts`'s
  `.upsert(rows, { onConflict: "external_message_id" })` compiles to a plain
  `ON CONFLICT (external_message_id)` with no predicate — Postgres will not
  infer a partial unique index for that, and Supabase's `.upsert()` has no
  way to express the predicate that would let it. Every sync failed at this
  step 100% of the time, unconditional on data — confirmed identical across
  all 5 tenant schemas (not drift) via direct schema inspection, which also
  showed `ebay_messages` was still empty everywhere (the failed `ON CONFLICT`
  clause means the whole upsert statement fails before writing any row, so
  converting the index carried zero duplicate-data risk). `033` drops and
  recreates it as a full unique index — functionally identical for the
  outbound rows it was trying to protect, since Postgres never treats two
  `NULL`s as conflicting under a plain `UNIQUE` index either. **If you ever
  add another partial unique index that an `.upsert()` call targets via
  `onConflict`, it will fail the same way** — Supabase's JS client cannot
  express a partial-index predicate in that option.
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
- **No push sync — messages only update when someone opens the page
  (fetched automatically, no button since 2026-08-27).** Unlike orders
  (`api/integrations/review`), there's no scheduled/cron sync route in this
  codebase (see `AGENTS.md`), and eBay's Trading API has no webhook for
  member messages. A buyer's new message won't appear until someone opens
  `/dashboard/messages` — which now syncs unconditionally, every visit, no
  throttle. That was a deliberate choice over debouncing (e.g. "only if the
  last sync was >5 min ago") for simplicity; each real sync is a live ~5s
  Trading API call (see the Vercel-log-driven investigation elsewhere in
  this file), so if this page ever gets a lot of foot traffic, revisit
  whether every visit still needs a live call.
- **`avatarColor.ts`'s Tailwind classes must stay full static strings —
  do not "simplify" them into a template literal.** Tailwind's JIT scanner
  reads source text at build time, not runtime values; `` `bg-(--color-avatar-${n})` ``
  would be invisible to it and silently generate no CSS for any avatar but
  whichever ones happen to also appear literally elsewhere in the codebase.
  `components/ui/Badge.tsx`'s `VARIANT_CLASSES` is the same pattern for the
  same reason — if you add a 7th avatar color, add both a new literal string
  to the `AVATAR_CLASSES` array AND the matching `--color-avatar-7`/
  `-7-text` pair in `globals.css`.
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
