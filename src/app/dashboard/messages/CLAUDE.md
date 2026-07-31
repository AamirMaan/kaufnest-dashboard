# Messages feature

Route: `/dashboard/messages`. Lets an admin/super_admin read and reply to
eBay buyer messages without leaving the dashboard. Gated the same way as
Listings/Integrations (`hasPlatformIntegrations`) plus a dedicated
`manage_messages` permission (admin/super_admin only — nav entry is visible
to all roles, but the reply box and "Sync messages" button both require the
permission; RLS on `ebay_messages` is admin/super_admin-only for every
operation, so other roles simply see an empty thread list).

There's no push/webhook for eBay buyer messages — sync is on-demand only
(the "Sync messages" button, no cron). See `src/lib/integrations/SKILL.md`'s
"eBay messages" section for the Trading API mechanics this reuses.

## Files in this folder

- `page.tsx` — paginated flat message list (`fetchMessagesPage` thunk, same
  pagination architecture as Sales/Purchases/Listings), grouped client-side
  into threads via `_lib/groupThreads.ts`. Two-pane layout: `ThreadList`
  (left) + `ThreadView`/`ReplyBox` (right). Also gates the whole page behind
  `hasPlatformIntegrations(tenantPlan)` with an upgrade prompt, same as
  Listings.
- `_lib/groupThreads.ts` — pure `groupThreads(messages)` (groups by
  `buyer_username + item_id`, most-recently-active thread first) and
  `latestInboundMessage(thread)` (the message a reply threads off of — its
  `external_message_id` becomes eBay's `ParentMessageID`). Colocated test.
- `_components/ThreadList.tsx` — left pane, one row per thread with an
  unread-count `Badge`.
- `_components/ThreadView.tsx` — right pane, chat-bubble rendering of the
  selected thread's messages (inbound left, outbound right).
- `_components/ReplyBox.tsx` — controlled textarea + Send button. Disabled
  when the selected thread has no inbound message to reply to (Trading API's
  `AddMemberMessageRTQ` requires a `ParentMessageID`) — see the "v1 scope"
  gotcha below.
- `_store/messagesSlice.ts` — `state.messages` (`items`, `loaded`, `page`,
  `pageSize`, `total`, `isFetching`, `isSyncing`). Actions: `hydratePage`
  (aliased `hydrateMessages`), `addMessage`, `setFetching`. Thunks:
  `fetchMessagesPage({ page, pageSize })`, `syncMessages()` (POSTs
  `/api/messages/ebay/sync`, caller re-fetches page 1 on success — the slice
  doesn't try to merge an unknown-sized synced batch itself), `sendReply({
  messageId, text })` (POSTs `/api/messages/[id]/reply`, unshifts the
  returned row via its own `fulfilled` case).

## v1 scope: reply-only, no new conversations

Only replying to an existing buyer message is supported
(`AddMemberMessageRTQ`). Starting a brand-new outbound message not tied to
one (`AddMemberMessageAAQToPartner`) is out of scope — sellers respond to
buyers here, they don't initiate. This means a thread with zero inbound
messages (shouldn't normally happen, since threads only exist because a
buyer messaged first) has a disabled `ReplyBox`.

## Data flow

Same pattern as Listings: `dashboard/layout.tsx` fetches page 1 of
`ebay_messages`, `StoreProvider` hydrates `state.messages`. "Sync messages"
and "Send reply" are the only two server round-trips
(`src/app/api/messages/`), since only those need the tenant's stored eBay
OAuth token.

## Shared dependencies

- `components/ui/{Badge, Button, Pagination, Toast}`
- `components/layout/PageHeader`
- `store/slices/currentUserSlice` (`tenantPlan`, `profile.role`/`permission_overrides`)
- `lib/utils/{date, permissions, planGating, pagedQuery}`
- `lib/integrations/{authGuard, tokenStore, ebay}` — server-only, used by the
  two API routes, never imported client-side
- `lib/integrations/ebay/messages.ts` — `fetchMemberMessages`/`replyToMessage`
  (Trading API calls)
- `types` (`EbayMessage`, `MessageDirection`)

## Tests

`npx jest dashboard/messages` runs `_store/messagesSlice.test.ts` and
`_lib/groupThreads.test.ts`.
