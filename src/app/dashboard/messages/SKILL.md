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

- **The GetMemberMessages XML parsing is unverified against a live
  response.** `lib/integrations/ebay/messages.ts` was written from eBay's
  documented Trading API schema, not tested against a real synced account
  (no sandbox test message data was available at implementation time). If
  `fetchMemberMessages` returns messages with an empty `itemId`/
  `buyerUsername`, or misses messages entirely, the first thing to check is
  whether `<ItemID>` and `<Incoming>`/`<Sender>`/`<RecipientID>` actually
  nest the way `parseExchangeBlock` assumes (comment at the top of that
  file). Log a raw response and compare against the parser before assuming
  the bug is elsewhere.
- **Scope reuse is also unverified.** This feature deliberately reuses the
  eBay connection's existing `sell.inventory` OAuth scope (same one
  `listings.ts`'s `GetMyeBaySelling` uses) rather than adding a new scope to
  `EBAY_SCOPE` in `lib/integrations/ebay.ts` — on the assumption Trading API
  messaging calls work with any valid seller token. If `GetMemberMessages`/
  `AddMemberMessageRTQ` return the token-scope error codes
  (`tradingApi.ts`'s `21916984`/`21917053`/`931`/`932` list), the existing
  "disconnect and reconnect" error message will surface, but reconnecting
  won't actually add a new scope — nothing requests one. If that turns out
  to be needed, the fix is adding to `EBAY_SCOPE`, which invalidates *every*
  existing eBay connection (documented precedent: see the
  `sell.inventory`-not-`.readonly` comment in `ebay.ts`).
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
`npx jest lib/integrations/ebay/messages` (XML-parsing fixture test).
