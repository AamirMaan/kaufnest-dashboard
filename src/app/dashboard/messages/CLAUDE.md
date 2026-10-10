# Messages feature

Route: `/dashboard/messages`. Lets a user with `messages` section access read
and reply to eBay buyer messages without leaving the dashboard. Gated on the
**Business plan** (`hasMessagingAndListings` — not
`hasPlatformIntegrations`/Pro+Business, changed 2026-08-27 alongside the same
change to Listings) **and** a connected eBay account, plus `can("messages",
2)` (`useAccess()`, Task 5, 2026-09-30 — replaced the earlier
`manage_messages` permission check; accountant's role default is `messages:
0`, so the Sidebar nav entry is hidden for a default accountant too, not just
the reply box/auto-sync — a change from the pre-Task-5 behavior where the nav
entry showed for every role).

There's no push/webhook for eBay buyer messages — sync runs once per page
visit (2026-08-27: the manual "Sync messages" button was removed; `page.tsx`
calls the same thunk from a `useEffect` on mount instead), still no cron.
See `src/lib/integrations/SKILL.md`'s "eBay messages" section for the
Trading API mechanics this reuses.

## Files in this folder

- `page.tsx` — flat message list fetched via `fetchMessagesPage` (same
  underlying paged-query shape as Sales/Purchases/Listings), grouped
  client-side into threads via `_lib/groupThreads.ts`. **Not the shared
  `<Pagination>` UI, though** (2026-08-27) — the left pane scrolls
  infinitely instead: `ThreadList` fires `onLoadMore` near the bottom, which
  dispatches `fetchMessagesPage({ page: page + 1, pageSize })`; `page > 1`
  results append in the slice rather than replace (see `messagesSlice.ts`
  below). A debounced (300ms) search input above the list dispatches
  `searchMessages(query)` on eBay/`ebay_messages` (server-side `ilike` over
  `body`/`buyer_username`, capped at 200 results — see the slice) instead of
  filtering `items` client-side; if it filtered client-side it would
  silently miss anything not yet scrolled into view, matching the
  project-wide pagination rule in `AGENTS.md` (filters go into the query,
  not client-side). While `searchQuery` is non-empty the thread list is
  built from `searchResults` instead of `items`, and infinite-scroll loading
  is paused (search's own 200-row cap is its only "pagination"). Two-pane
  layout: `ThreadList` (left) + `ThreadView`/`ReplyBox` (right). Gates the
  whole page behind `hasMessagingAndListings(ent)` (`usePlan()`; upgrade copy
  from `availability("messagingAndListings", "eBay messaging")`)
  with an upgrade prompt, THEN a connected-eBay check
  (`s.integrations.connections`) with a "connect eBay" prompt — same
  two-guard sequence as `dropshipping/page.tsx` and Listings'
  `BusinessEbayGate.tsx` (2026-08-27; there's no shared component here since
  Messages has only one route to gate, unlike Listings' three). `runSync`
  (a `useCallback`-memoized wrapper around `syncMessages()` +
  `fetchMessagesPage({ page: 1 })`) fires once from a `useEffect` on mount,
  gated on `canManage` **and** the eBay connection being present — added
  2026-08-27, since without it a disconnected tenant's auto-sync would still
  fire and hit the sync route's own "eBay is not connected" 400 every visit,
  for no benefit (the page shows the connection-required prompt instead of
  the thread list either way). Status is shown inline
  where the button was: "Checking eBay…" while `isSyncing`, "Updated
  `<time>`" after a successful sync, or "Couldn't refresh messages — Retry"
  (calls `runSync` again) on failure — there's no other manual re-sync
  affordance, so a failed auto-sync must not fail silently.
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
  `VARIANT_CLASSES` for the same pattern). Colocated test. **Second consumer
  as of 2026-09-27:** `dashboard/_components/RecentOrdersCard.tsx` imports
  `avatarClassesFor` directly for Home's recent-orders row avatars, keyed by
  the resolved buyer/platform label rather than an eBay username. Still a
  Messages-owned file (2 consumers, below the "3+ features" promotion
  threshold in the root `AGENTS.md`) — promote it to `src/components/ui/` if
  a third feature needs it, rather than a third feature reaching into
  `messages/_lib/` directly.
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
  Also (2026-09-28) `timeLabelFor(iso)` ("11:05 AM", under each bubble) and
  `threadDateLabel(iso, now?)` (conversation-list date: time today, "Feb 22"
  this year, "Dec 30, 2025" older) — same en-US/local-day rules.
- `_lib/messageBody.ts` (2026-09-28) — pure `cleanMessageBody(body)` /
  `messagePreview(body)`. eBay bodies arrive with XML character references
  left in — every line of a seller-template message ended in a literal
  `&#xd;` in the UI. Decodes numeric/named references, normalises CR/CRLF,
  trims lines, collapses blank-line runs; `messagePreview` also flattens to
  one line for the list. **Display-only** — `ebay_messages.body` is stored
  raw, so existing rows are fixed without a backfill. Colocated test.
- `_components/ThreadList.tsx` — left pane, one rounded row per thread
  (chat-app redesign 2026-09-28, no dividers, selected row gets
  `--color-surface-subtle`): 44px avatar circle (`avatarColor.ts`), buyer name
  (bold when unread) + `threadDateLabel` date on the right, last-message
  `messagePreview` ("You: " prefix for outbound) + a small solid-primary
  unread-count pill (one indicator only — an extra amber avatar dot was
  dropped as noise, since most synced threads are unanswered), and a faint
  item-title line (threads are per buyer+item, so two rows for one buyer
  must stay distinguishable). Owns its
  own scroll container (2026-08-27, was previously owned by `page.tsx`) so
  it can drive infinite scroll: an `onScroll` handler fires the optional
  `onLoadMore` prop once the user scrolls within `150px` of the bottom,
  gated on `hasMore`/`isLoadingMore` props from `page.tsx`. Renders a
  "Loading more…" footer while `isLoadingMore`, and accepts an
  `emptyMessage` override (`page.tsx` uses it to show "No conversations
  match your search" instead of the default "sync to pull in messages"
  copy when a search is active).
- `_components/ThreadView.tsx` — right pane: a header bar (avatar + bold
  name + item **title** · price, and an icon-only "View listing on eBay"
  `ExternalLink` button on the right when `item_url` is present — the chat
  design's call/video icon slot; eBay messaging has no calls or presence — falls back to the bare "Item
  `<id>`" for rows synced before migration `034` added these columns, or
  if a response ever lacks them; this pane had no header at all before
  2026-08-27) above chat-bubble rendering of the selected thread's
  messages. **Chat-app redesign (2026-09-28, user-requested from a reference
  screenshot):** pill bubbles (`rounded-3xl`), timestamp (`timeLabelFor`)
  *below* each bubble rather than inside it, outbound gets a `CheckCheck`
  "sent" tick, and the day separator is an uppercase label between two
  hairlines instead of a pill. Outbound (your replies) render right-aligned
  in solid `--color-primary` + white — this **reverses** the earlier
  "soft primary-muted so it doesn't look like a button" choice, on the
  user's explicit request to match the reference design. Inbound
  renders left-aligned; still-unanswered inbound (`!is_read`) gets an amber
  left-border/tint (`--color-warning`/`--color-warning-bg`) so it's visually
  obvious which questions still need a reply, even partway down a long
  thread — see the `is_read` gotcha in `dashboard/messages/SKILL.md` for
  what that flag actually tracks (answered-on-eBay, not seen-by-you).
  **All** inbound bubbles (answered or not) are soft gray; unanswered ones
  are flagged by a small amber "Needs reply" pill beside the timestamp — the
  earlier amber tint + thick left border turned long seller-template
  messages into a wall of amber. Bodies render through `cleanMessageBody`.
  The message pane auto-scrolls to the newest message on thread switch and
  whenever the message count changes. Inbound bubbles use
  `bg-(--color-surface-subtle)` — valid again
  as of 2026-09-28 because the whole chat card now has an explicit
  `bg-(--color-surface)` in `page.tsx`; before that the pane sat on the
  page background, which *is* `--color-surface-subtle`, and the bubble was
  invisible (see the SKILL.md gotcha). A day separator (`dayLabel.ts`) is
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
- `_components/ReplyBox.tsx` — a real `<form id="message-reply-form">`
  (form conventions): auto-growing 1-row textarea (`field-sizing-content`,
  capped `max-h-40`, `required`) + square icon-only submit button
  (`SendHorizontal`, swaps to a spinning `Loader2` while sending, disabled
  while sending or empty). Enter submits via `form.requestSubmit()`,
  Shift+Enter inserts a newline, IME composition is ignored. No
  attachment/emoji buttons — eBay's reply call is plain text. Disabled
  when the selected thread has no inbound message to reply to (Trading API's
  `AddMemberMessageRTQ` requires a `ParentMessageID`) — see the "v1 scope"
  gotcha below. `onSend` returns `Promise<boolean>` (fixed 2026-08-27, was a
  real bug): the typed text is only cleared once the parent's send actually
  resolves successfully — it previously cleared synchronously on click,
  before the network call even started, so a failed send silently lost what
  was typed with no way to recover it. The textarea stays visible and
  populated (just disabled) while `sending` is true instead.
- `_store/messagesSlice.ts` — `state.messages` (`items`, `loaded`, `page`,
  `pageSize`, `total`, `isFetching`, `isLoadingMore`, `isSyncing`,
  `searchQuery`, `searchResults`, `isSearching`). Actions: `hydratePage`
  (aliased `hydrateMessages`), `addMessage`, `setFetching`, `clearSearch`.
  Thunks: `fetchMessagesPage({ page, pageSize })` — **`page === 1` merges,
  `page > 1` appends** (2026-08-27, for infinite scroll); tracked via a
  separate `isLoadingMore` flag (set in `.pending` only when
  `action.meta.arg.page > 1`) so a scroll-triggered load never shows the
  same "Loading…" indicator as an initial/post-sync fetch. **Page 1 merges
  by id rather than replacing outright (fixed 2026-08-27, was a real bug)**:
  auto-sync's own page-1 refetch can resolve *after* a reply the user just
  sent (`sendReply.fulfilled` unshifts it into `items` immediately) if the
  underlying eBay sync call was slow enough that this query ran before the
  reply committed — a blind replace silently erased the just-sent reply from
  the UI until the next real fetch. Fresh rows win by id; anything present
  only locally (not yet reflected in this response — e.g. that reply, or
  older items loaded by scrolling) survives alongside them. `total` is
  floored at `Math.max(count, items.length)` for the same reason: a stale
  response's count must never regress below what's already held locally.
  `syncMessages()` (POSTs `/api/messages/ebay/sync`, caller re-fetches
  **page 1** on success). `searchMessages(query)` (2026-08-27 — server-side
  `ilike` over `buyer_username`/`body` via `createTenantClient()`, capped at
  200 rows, `ilike` wildcard characters escaped in the query text; stores
  into `searchQuery`/`searchResults`, separate from `items`/`page`/`total`
  entirely). `sendReply({ messageId, text })` (POSTs
  `/api/messages/[id]/reply`, unshifts the returned row via its own
  `fulfilled` case). The reply route's insert copies
  `item_title`/`item_price`/`item_currency`/`item_url` from the original
  message being replied to, same as it already does for
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

- `components/ui/{Badge, Button, Toast}` — **not** `Pagination` (removed
  2026-08-27 in favor of infinite scroll, see `ThreadList.tsx` above)
- `components/layout/PageHeader`
- `store/usePlan` — `ent` + `availability()` for the plan gate (client
  side; the server side is `lib/plans/requirePlanFeature`'s
  `requireMessagingAndListings(tenantSchema)`, called right after the
  section guard in `app/api/messages/{[id]/reply,ebay/sync}` — 2026-10-03)
- `store/useAccess` — `useAccess().can("messages", 2)` (Task 5 — replaced
  `lib/utils/permissions`' `hasPermission`)
- `store/slices` — `s.integrations.connections` (the eBay-connected check;
  hydrated app-wide by `dashboard/layout.tsx`/`StoreProvider`, same slice
  Dropshipping/Listings use)
- `lib/utils/{date, pagedQuery, currency}`; `lib/plans/entitlements`'
  `hasMessagingAndListings` specifically, not `hasPlatformIntegrations`
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
