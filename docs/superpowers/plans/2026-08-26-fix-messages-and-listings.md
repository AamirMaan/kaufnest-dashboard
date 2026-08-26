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
which wasn't provided.** If the fix below doesn't fully resolve sync on the
next real attempt, `tradingApiCall`'s new logging will show the actual eBay
response instead of requiring another multi-hour investigation.

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
