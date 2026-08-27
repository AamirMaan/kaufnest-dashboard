# Plan — Fix Messages sync (502) and Listings

**Date:** 2026-08-26
**Branch:** `fix/messages-listings-trading-api` (per `AGENTS.md` — never commit to `main`)
**Status:** Phase 0 resolved without the captured error text (neither the
browser Network tab nor a fresh Vercel log was available in this session).
Root cause confirmed instead via eBay's own Trading API type reference
(`MessageStatusTypeCodeType` = `Answered`/`Unanswered`/`CustomCode` only —
`All` is not a member) plus live data: `ebay_messages` is empty across all 5
tenant schemas, so sync has never once succeeded — ruling out Hypothesis 2
(a scope *regression* implies prior success) in favor of Hypothesis 1
(untested code, which the feature's own SKILL.md already flagged as a risk).
**Hypothesis 1 fixed, plus the two independent bugs and Phase 3's logging.
Hypothesis 2 (scope) and Phase 2 (listings) are NOT addressed — no evidence
either needs it, and Phase 2 explicitly requires knowing the symptom first,
which wasn't provided.**

**Update 2026-08-26, later same day:** the enum fix made sync succeed but
return 0 messages. Rather than guess, added `console.info`/`console.warn`
diagnostics and asked the user to run a real sync and paste the Vercel log
line. First result: `{ exchangeBlocks: 46, messagesParsed: 0 }` — eBay
genuinely returns 46 conversations (disproving an "active listings only"
scoping theory raised in between), but every block failed to parse. A
second, more targeted diagnostic (tag names only, never message content,
for privacy) then revealed the real cause: `parseExchangeBlock` assumed the
wrong wrapper tag (`<MemberMessage>`, which doesn't exist) and several wrong
field names (`Sender`→`SenderID`, `Text`→`Body`, no `<Incoming>`/`<Read>` at
all). Fixed against the confirmed shape — see the wrapper-tag/field-name
gotcha in `dashboard/messages/SKILL.md` for the full mapping. **Sync should
now actually populate messages; this needs the user to confirm on the next
real attempt.** The diagnostic logging is kept permanently as defense
against a future eBay schema change, not removed post-fix.

**Update 2026-08-27:** parsing now works (`{ exchangeBlocks: 46,
messagesParsed: 46 }`), but sync then failed one step later at the Supabase
write: `{ error: "Failed to save synced messages" }`. Checked the live
schema directly rather than asking for another log round-trip — found it
immediately: `idx_ebay_messages_external_id` (from `026_ebay_messages.sql`)
is a PARTIAL unique index (`WHERE external_message_id IS NOT NULL`), but
`sync/route.ts`'s `.upsert(rows, { onConflict: "external_message_id" })`
compiles to a plain `ON CONFLICT (external_message_id)` with no predicate —
Postgres won't infer a partial index for that, and Supabase's `.upsert()`
has no way to supply the missing predicate. Confirmed identical (not tenant
drift) and confirmed the table was still empty in all 5 schemas (a failed
`ON CONFLICT` clause fails the whole statement before writing anything, so
converting the index carried zero duplicate-data risk). Migration `033`
drops and recreates it as a full unique index — this needs the user to
apply it, then re-sync to confirm messages actually land in the table this
time. No application code changed; this is a pure schema fix.

**Update 2026-08-27, later:** messages now land, and a first UI pass shipped
(auto-sync, avatars, bubble split, unanswered tint). User feedback on that
pass surfaced two more real bugs, found by checking data rather than
guessing from the screenshot:

1. **`--color-surface-hover` never existed in `globals.css`.** Pre-dates
   this whole investigation — every inbound-answered bubble (and the
   ThreadList row hover) had a fully transparent background this entire
   time, since an undefined CSS custom property with no fallback reverts to
   `transparent`, not to any visible color. Fixed to the app's actual
   established token, `--color-surface-subtle`.
2. **`<CreationDate>` isn't nested inside `<Question>` either — same class
   of bug as the wrapper-tag mismatch from 2026-08-26, not yet located.**
   Checked directly against the database: nearly every multi-message thread
   collapses to exactly one distinct `ebay_created_at`, the signature of
   `parseExchangeBlock`'s `?? new Date().toISOString()` fallback firing for
   every message in a sync. This blocks the requested day-separator feature
   from being meaningful — it's built and tested, but will show one
   separator per thread today, not real per-day grouping, until this is
   fixed. Added a fully redacted structural-skeleton diagnostic (tag names/
   nesting only, zero content) to `fetchMemberMessages` rather than guess a
   third time where the field actually lives — needs one more real sync +
   log check, same pattern as before.

Also removed the per-bubble `subject` render entirely: confirmed live that
eBay's `Subject` value for these messages is a full auto-generated sentence,
identical across every message in a thread — pure repeated noise once the
header already names the buyer and item.

---

## What we actually know

From the Vercel invocation log for `POST /api/messages/ebay/sync`
(`dpl_9jxspA3yW9P4fZmQir7xuTcPJsB1`, Aug 26 19:35:32):

| Evidence | What it rules in / out |
| --- | --- |
| **Execution duration 1.18s** | ❌ Not a timeout, not a `maxDuration` overrun, not a cold-start/memory kill. The function ran to completion and *chose* to return 502. |
| **Fluid 224 MB** | ❌ Not a memory limit. |
| **Firewall: Allowed**, routed fra1 | ❌ Not a WAF/edge rejection. |
| **Exactly 1 POST** to an external API | The single POST is almost certainly the Trading API call itself. `fetchMemberMessages` loops up to `MAX_PAGES = 10` — only one page was attempted, so **it threw on page 1**. |
| **6 GETs** | Consistent with the Supabase reads before the call: `auth.getUser()`, `profiles`, `platform_connections`, `ebay_messages` latest, plus SSR cookie/session traffic. |

**Critical: the 502 is self-inflicted, not infrastructure.**
`src/app/api/messages/ebay/sync/route.ts:81-84` catches any throw and returns
`{ error: message }` with `status: 502`. So:

1. The failure is inside `fetchMemberMessages` (or the `ebay_messages` upsert).
2. **The real error string is already in the response body.** Nobody has read it yet.
3. It cannot be the token refresh — that path returns **500**, not 502
   (`route.ts:38-43`). So `ensureValidAccessToken` succeeded and we reached the
   `try` block.

---

## Phase 0 — Capture the real error (blocking, ~5 minutes)

Everything below is hypothesis until this is done. Two ways, do either:

**A. Browser (fastest, no deploy):**
DevTools → Network → click the `sync` request → **Response** tab. The JSON body
contains the thrown message verbatim — e.g.
`eBay Trading API error 21916984: ...` or
`eBay Trading API request failed: 400 <?xml...`.

**B. Make it visible in Vercel logs (do this anyway — see Phase 3):**
Add before the 502 return in `route.ts`:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : "Sync failed";
  console.error("[messages/ebay/sync] failed:", message);   // ← add
  return NextResponse.json({ error: message }, { status: 502 });
}
```

**Decision gate:** the error text routes you to exactly one branch in Phase 1.
Record it in this file before proceeding.

---

## Phase 1 — Messages sync

### Hypothesis 1 (most likely) — `<MessageStatus>All</MessageStatus>` is not a valid enum

`messages.ts:36-37` sends:

```xml
<MailMessageType>All</MailMessageType>
<MessageStatus>All</MessageStatus>
```

`MailMessageType` does legitimately accept `All`. **`MessageStatus` does not** —
eBay's `MessageStatusType` enumeration is `Answered` / `Unanswered`. An invalid
enum value produces `Ack=Failure` on the *first* call, which is exactly the
observed signature: one POST, sub-2s, thrown.

**Fix:** omit the element entirely (it's optional; omitting returns all statuses).

```diff
- "<MessageStatus>All</MessageStatus>" +
```

**Verify before shipping** against the current
[GetMemberMessages docs](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetMemberMessages.html)
— confirm the enum, don't take this plan's word for it.

### Hypothesis 2 — OAuth scope doesn't cover Trading API messaging

`src/app/dashboard/messages/SKILL.md` flags this explicitly as **unverified**:
the feature reuses the existing `sell.inventory` scope on the assumption that
Trading API messaging calls accept any valid seller token.

**Tell:** error code `21916984`, `21917053`, `931`, or `932` → `tradingApi.ts:72`
converts these into the "disconnect and reconnect" message.

**Trap:** that message is *misleading here*. Reconnecting will not help, because
`EBAY_SCOPE` (`ebay.ts:18-21`) never requests a messaging scope — nothing new
gets granted. If this is the cause, the real fix is adding the scope to
`EBAY_SCOPE`, **which invalidates every existing eBay connection across all 5
tenants** and forces each to re-authorise. That is a coordinated change, not a
hotfix — treat it as its own task with tenant comms.

### Hypothesis 3 — Date range rejected

`StartCreationTime` is set 90 days back on first sync (`route.ts:11`). eBay
caps the creation-time window for this call. If the error mentions the time
range, clamp the default lookback (30 days) and/or send an explicit
`EndCreationTime`.

### Hypothesis 4 — Upsert failure

Less likely: migrations 026–030 are confirmed applied 5/5 tenants
(`supabase/SKILL.md`, verified live 2026-08-06), so the partial unique index
backing `onConflict: "external_message_id"` exists. Only revisit if the error
text is a Postgres error (e.g. `42P10`).

### Independent bug to fix regardless — pagination parsing

`messages.ts:101`:

```ts
const totalPages = Number(tagText(xml, "PaginationResult")?.match(/(\d+)/)?.[1] ?? "1");
```

This grabs the **first number anywhere** inside `<PaginationResult>`, which also
contains `<TotalNumberOfEntries>`. It works only if eBay happens to emit
`TotalNumberOfPages` first — undefined behaviour, and it would silently truncate
or over-fetch. `listings.ts:86` already does this correctly. Make them match:

```ts
const pagination = tagText(xml, "PaginationResult") ?? "";
const totalPages = Number(tagText(pagination, "TotalNumberOfPages") ?? "1");
```

### Second latent bug — `Incoming` defaults to inbound

`messages.ts:60`: `const incoming = tagText(block, "Incoming") !== "false";`

If `<Incoming>` is absent or nested differently than assumed, `tagText` returns
`null`, and `null !== "false"` is `true` — so **every message silently becomes
inbound**, and `buyerUsername` is read from the wrong field. Combined with the
`notify_message_received` trigger (migration 029, inbound-only), that would also
spam notifications for the tenant's own replies. Make the absence explicit:

```ts
const incomingRaw = tagText(block, "Incoming");
if (incomingRaw === null) { /* log once — schema assumption broken */ }
const incoming = incomingRaw !== "false";
```

---

## Phase 2 — Listings triage

You didn't specify the symptom, so this phase starts with identification. There
are **three independent listings paths** and they fail for different reasons:

| Path | Entry point | API used | Shares code with messages? |
| --- | --- | --- | --- |
| **A. Dropshipping refresh** | `/dashboard/dropshipping` → Refresh | Trading API `GetMyeBaySelling` via `fetchActiveListings` | ✅ **Yes — same `tradingApi.ts`** |
| **B. Wizard dropdowns** | `/dashboard/listings/new` → Category/Policies steps | REST Taxonomy + Account APIs | ❌ No |
| **C. Publish** | `/dashboard/listings/[id]` → Publish | REST Inventory API | ❌ No |

**Start with A.** If messages and listings broke *at the same time*, path A is
the overwhelmingly likely overlap — both go through `tradingApiCall()` with the
same token and the same `Ack=Failure` handling. A single scope/token regression
explains both symptoms at once, and fixing Phase 1's root cause may fix this for
free.

If the broken path is B or C, it's unrelated to the messages bug and needs its
own diagnosis — both return 502 from their own catch blocks too, so Phase 0's
technique applies identically (read the response body).

**Note on B:** `listings/SKILL.md` documents a previously-fixed bug where
category search used the seller's user token instead of an application token
(403, errorId 1100). If category dropdowns are empty again, check whether that
regressed.

---

## Phase 3 — Stop this recurring

The reason this cost hours: **a 502 with the answer in the response body, and
nothing in the server logs.** Fix that class of problem.

1. **Log before every 502.** `console.error` in the catch of every
   `api/messages/*` and `api/listings/*` route. Cheap, and makes Vercel logs
   diagnostic instead of decorative.
2. **Don't reuse 502 for "our code threw."** 502 means "bad upstream response."
   A parse failure or DB error is a 500. Keeping 502 strictly for genuine eBay
   failures makes the status code itself informative.
3. **Log the raw eBay XML on `Ack=Failure`** (truncated, no token) in
   `tradingApi.ts` — every hypothesis above needed the raw response, which nobody
   had.
4. **Fixture-test the parser against a real response.** Once sync works, capture
   one real `GetMemberMessages` XML body, redact usernames, commit it as a
   fixture, and assert `parseExchangeBlock` output. This closes the
   "unverified against a live response" gotcha that both SKILL.md files carry.

---

## Test plan

- `npx jest lib/integrations/ebay/messages` — extend with the real-response fixture.
- `npx jest dashboard/messages` — slice + `groupThreads` regression.
- Manual: `/dashboard/messages` → Sync → expect a count, not an error toast.
- Manual: reply to a thread → confirm it lands in eBay (round-trip, not just a 200).
- Manual: `/dashboard/dropshipping` → Refresh → listings populate.

Per `AGENTS.md`: don't run the dev server or `npm test` mid-task — ask for the
output. Write tests alongside the fix, in the same commit.

---

**Update 2026-08-27, third round:** the first UI-polish pass (auto-sync,
avatars, bubble redesign) shipped and got real user feedback. Three items,
each verified before touching code rather than assumed:

1. **Day labels showed German ("Heute") when the app's system language is
   English.** Genuine mistake — I'd matched `lib/utils/date.ts`'s existing
   `de-DE` convention, but that reflects the *buyer messages'* language
   (German marketplace), not the app's own UI language. Fixed to English.
2. **"Why aren't my messages on the right?"** — checked the database first:
   zero outbound rows and zero `message`-entity audit log entries exist
   anywhere. No reply has actually been sent yet, so there was nothing to
   observe failing. Not content to leave it at that a third time, though:
   re-read my own alignment code and found a real fragility regardless — a
   `display:contents` wrapper controlling `align-self` on its former
   children, a CSS combination with a genuinely rocky cross-browser
   history. Replaced with a `Fragment` (zero DOM nodes, sidesteps the
   question entirely) rather than assert the original was definitely fine.
3. **Show real article details instead of a bare item number.** Confirmed
   `GetMemberMessages`' `<Item>` block already carries `Title`,
   `CurrentPrice`+`currencyID`, and `ViewItemURL` (from the schema
   investigation two days earlier) — the app was parsing `<ItemID>` only
   and discarding the rest. Added migration `034` (nullable columns,
   2-places rule), threaded through parsing/upsert/UI. Caught one real bug
   while doing it: `groupThreads.ts` reads item details from the thread's
   *latest* message, and the reply route's local insert didn't carry them
   — meaning the very first reply a user sent would have blanked the title
   it just took two rounds of work to add. Fixed by copying those fields
   onto the reply insert, same as `item_id`/`buyer_username` already are.

No further CreationDate evidence yet — that fix (see the second 2026-08-27
update above) is still pending a sync + log check, independent of this round.

---

## Docs to update when done (mandatory per `AGENTS.md`)

- `src/app/dashboard/messages/SKILL.md` — replace the two "unverified" gotchas
  with what the live response actually proved. This is the highest-value edit in
  the whole task: it converts a guess into a fact for the next person.
- `src/app/dashboard/listings/SKILL.md` — only if Phase 2 touches it.
- `src/lib/integrations/SKILL.md` — if `tradingApi.ts` error handling changes.

---

## Open questions

1. **Did this ever work?** If messages sync succeeded even once, the cause is a
   regression (scope change, eBay API deprecation, token state) rather than
   never-working code. If it has never succeeded, Hypothesis 1 is far more
   likely — the SKILL.md admits it shipped untested against a live account.
2. **Which tenant?** Is this one tenant's connection or all five? One tenant
   points at token/connection state; all five points at code or scope.
3. **Same for listings** — did it break at the same time as messages? Same-time
   failure is strong evidence for the shared `tradingApi.ts` path.
