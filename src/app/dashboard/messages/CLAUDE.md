# Messages feature

Route: `/dashboard/messages`. Lets an admin/super_admin read and reply to
eBay buyer messages without leaving the dashboard. Gated the same way as
Listings/Integrations (`hasPlatformIntegrations`) plus a dedicated
`manage_messages` permission (admin/super_admin only — nav entry is visible
to all roles, but the reply box and auto-sync both require the permission;
RLS on `ebay_messages` is admin/super_admin-only for every operation, so
other roles simply see an empty thread list).

There's no push/webhook for eBay buyer messages — sync runs once per page
visit (2026-08-27: the manual "Sync messages" button was removed; `page.tsx`
calls the same thunk from a `useEffect` on mount instead), still no cron.
See `src/lib/integrations/SKILL.md`'s "eBay messages" section for the
Trading API mechanics this reuses.

## Files in this folder

- `page.tsx` — paginated flat message list (`fetchMessagesPage` thunk, same
  pagination architecture as Sales/Purchases/Listings), grouped client-side
  into threads via `_lib/groupThreads.ts`. Two-pane layout: `ThreadList`
  (left) + `ThreadView`/`ReplyBox` (right). Also gates the whole page behind
  `hasPlatformIntegrations(tenantPlan)` with an upgrade prompt, same as
  Listings. `runSync` (a `useCallback`-memoized wrapper around
  `syncMessages()` + `fetchMessagesPage({ page: 1 })`) fires once from a
  `useEffect` on mount, gated on `canManage` — the same permission that used
  to gate the removed button. Status is shown inline where the button was:
  "Checking eBay…" while `isSyncing`, "Updated `<time>`" after a successful
  sync, or "Couldn't refresh messages — Retry" (calls `runSync` again) on
  failure — there's no other manual re-sync affordance, so a failed auto-sync
  must not fail silently.
- `_lib/groupThreads.ts` — pure `groupThreads(messages)` (groups by
  `buyer_username + item_id`, most-recently-active thread first) and
  `latestInboundMessage(thread)` (the message a reply threads off of — its
  `external_message_id` becomes eBay's `ParentMessageID`). Colocated test.
- `_lib/avatarColor.ts` — pure `avatarClassesFor(username)`/`avatarInitial(username)`.
  Hashes a username into one of 6 fixed decorative Tailwind classes
  (`globals.css`'s `--color-avatar-1..6` tokens) — same buyer always gets the
  same color. Every return value is a full static class string, never
  interpolated (`bg-(--color-avatar-${n})` would be invisible to Tailwind's
  JIT scanner — see the file's own comment and `components/ui/Badge.tsx`'s
  `VARIANT_CLASSES` for the same pattern). Colocated test.
- `_lib/dayLabel.ts` — pure `dayLabelFor(isoDate, now?)` / `isNewDay(isoDate,
  previousIsoDate)`. WhatsApp-style day-separator logic: "Today"/"Yesterday"/
  weekday name for the last week, a short date beyond that. **English**,
  matching this app's system/UI language — deliberately NOT the buyer
  messages' language (German, since these are German eBay marketplace
  conversations) and NOT `lib/utils/date.ts`'s `de-DE` choice for
  `formatDate`/`formatDateTime`, a separate, unrelated existing decision
  this file doesn't touch. Corrected from an initial German-label version
  2026-08-27 — matching `lib/utils/date.ts`'s locale was the wrong instinct,
  since that reflects the buyer-facing content's language, not the app's own.
  Operates on the viewer's **local** calendar day deliberately (correct for
  a chat UI — matches how WhatsApp groups on a user's own device). Colocated
  test builds fixtures from local `Date` components round-tripped through
  `.toISOString()` rather than hardcoded UTC literals, specifically so it
  isn't timezone-flaky — `process.env.TZ` reassignment mid-test-file does
  **not** reliably work, Node caches timezone data at process start.
- `_components/ThreadList.tsx` — left pane, one row per thread: avatar
  circle (`avatarColor.ts`) + buyer name (bold when the thread has any
  unanswered inbound message) + the existing unread-count `Badge`.
- `_components/ThreadView.tsx` — right pane: a header bar (avatar + bold
  name + item **title**, linking to the live eBay listing when
  `item_url` is present, plus price — falls back to the bare "Item
  `<id>`" for rows synced before migration `034` added these columns, or
  if a response ever lacks them; this pane had no header at all before
  2026-08-27) above chat-bubble rendering of the selected thread's
  messages. Outbound (your replies) render right-aligned in
  `--color-primary-muted`/`--color-primary-text` (the same soft "brand
  chip" pairing already used elsewhere, e.g. `dashboard/page.tsx` —
  deliberately NOT the saturated `--color-primary` + white text used for
  buttons, so a sent bubble doesn't read as a clickable action). Inbound
  renders left-aligned; still-unanswered inbound (`!is_read`) additionally
  gets an amber left-border/tint (`--color-warning`/`--color-warning-bg`)
  so it's visually obvious which questions still need a reply, even
  partway down a long thread — see the `is_read` gotcha in
  `dashboard/messages/SKILL.md` for what that flag actually tracks
  (answered-on-eBay, not seen-by-you). Both directions get one rounded
  corner squared off (`rounded-br-none`/`rounded-bl-none`) for a
  WhatsApp-style bubble "tail." A day-separator pill (`dayLabel.ts`) is
  inserted before the first message of each new local calendar day, via a
  **`Fragment`** per message (not a wrapper `div`, and deliberately not
  `display:contents` either — that technically achieves the same flex-child
  flattening on paper, but its interaction with `align-self` has a real
  cross-browser history of quirks; a `Fragment` sidesteps the question
  entirely by adding no DOM node) so the optional centered separator and
  the self-start/self-end bubble can both be direct flex children.
  `message.subject` is intentionally **not** rendered per-bubble — eBay's
  own `Subject` value for these messages is a full auto-generated sentence
  ("`<buyer>` hat eine Nachricht gesendet zu `<item title>` #`<item id>`"),
  identical across every message in a thread, confirmed live 2026-08-27 —
  pure repeated noise once the header already names the buyer and item.
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
  returned row via its own `fulfilled` case). The reply route's insert
  copies `item_title`/`item_price`/`item_currency`/`item_url` from the
  original message being replied to, same as it already does for
  `item_id`/`buyer_username` — without this, sending a reply makes it the
  thread's newest message, and `groupThreads.ts` reading item details from
  the latest message would blank the title/price it just took two rounds
  of investigation to add, since a locally-created reply has no `<Item>`
  block of its own to parse them from.

## v1 scope: reply-only, no new conversations

Only replying to an existing buyer message is supported
(`AddMemberMessageRTQ`). Starting a brand-new outbound message not tied to
one (`AddMemberMessageAAQToPartner`) is out of scope — sellers respond to
buyers here, they don't initiate. This means a thread with zero inbound
messages (shouldn't normally happen, since threads only exist because a
buyer messaged first) has a disabled `ReplyBox`.

## Data flow

Same pattern as Listings: `dashboard/layout.tsx` fetches page 1 of
`ebay_messages`, `StoreProvider` hydrates `state.messages` — so the page
never renders blank while the auto-sync runs; stored messages show
immediately and update in place once sync + the page-1 re-fetch finish.
Sync and "Send reply" are the only two server round-trips
(`src/app/api/messages/`), since only those need the tenant's stored eBay
OAuth token.

## Shared dependencies

- `components/ui/{Badge, Button, Pagination, Toast}`
- `components/layout/PageHeader`
- `store/slices/currentUserSlice` (`tenantPlan`, `profile.role`/`permission_overrides`)
- `lib/utils/{date, permissions, planGating, pagedQuery, currency}`
  (`currency`'s `formatCurrency` renders `EbayMessage.item_price` in
  `ThreadView.tsx`'s header; `item_currency` is narrowed to the app's
  `Currency` union with an EUR fallback for display only — the stored raw
  value is untouched)
- `lib/integrations/{authGuard, tokenStore, ebay}` — server-only, used by the
  two API routes, never imported client-side
- `lib/integrations/ebay/messages.ts` — `fetchMemberMessages`/`replyToMessage`
  (Trading API calls)
- `types` (`EbayMessage`, `MessageDirection`)

## Tests

`npx jest dashboard/messages` runs `_store/messagesSlice.test.ts`,
`_lib/groupThreads.test.ts`, `_lib/avatarColor.test.ts`, and `_lib/dayLabel.test.ts`.
