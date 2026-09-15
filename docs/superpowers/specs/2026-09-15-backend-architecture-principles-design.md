# Backend & Data-Fetching Architecture Principles — design

## Problem

The Overview page and the Sales/Expenses/Purchases CSV exports were silently
truncated at 1000 rows by Supabase's PostgREST "Max Rows" API setting, despite
requesting `.limit(5000)` — confirmed live on `tenant_k2_textil` (1510 sales
rows, `Content-Range: 0-999/1510`, no error). That bug is fixed
(`src/lib/utils/fetchAllRows.ts`, PR #103), but the underlying gap is
process, not code: nothing in this repo told the agent that a single
`.limit()`/`.range()` call cannot be trusted to return what it asked for, or
gave a decision framework for which of several fetch patterns
(paginated-thunk / `fetchAllRows` / plain unbounded / RPC aggregation) fits a
given query.

A follow-up audit found more spots with the same class of exposure. **That
audit is recorded in Appendix A of this spec** — it was previously held only
in an unrecorded session, which would have forced sub-project 3 to re-derive
it from scratch. It has since been re-run and widened: **13 sites, of which 5
are latent correctness bugs rather than display truncation.**

This is the first of three sub-projects addressing that gap, in this order:

1. **This spec** — a backend/data-fetching architecture principles doc plus
   the two verifier rules that enforce its central invariant, so future work
   (including sub-projects 2 and 3) has a shared vocabulary and a machine
   check instead of ad hoc judgment calls.
2. Overview RPC aggregation rewrite (separate spec) — replaces
   `fetchAllRows`-based client aggregation on the Overview page with
   Postgres-side aggregation functions across all 5 live tenant schemas.
3. Audit-fix pass (separate spec) — applies this doc's decision framework to
   close the Appendix A findings.

Sub-projects 2 and 3 are out of scope for this spec — they get their own
design docs once this one lands, and will cite it rather than re-litigate it.

## Goals

- Give future agents (and human contributors) a decision framework for
  choosing a data-fetching pattern, so the Max Rows class of bug doesn't
  recur in a new feature.
- **Enforce the central invariant in code, not only in prose.** AGENTS.md's
  own rule is "a rule that only exists as prose is one nobody enforces" — and
  the `.limit(5000)` that caused PR #103 *looked* correct, so a doc alone
  would not have caught it. Ship verifier rules alongside the doc.
- Cover backend conventions more broadly, per explicit request: aggregation
  strategy (client vs. Postgres RPC), N+1 avoidance, API route auth-guard and
  error-response conventions.
- Complement, not duplicate, existing enforcement (`.claude/verifiers/`) and
  existing prose (AGENTS.md's "Key rules", `supabase/SKILL.md`'s
  `run_on_all_tenant_schemas` rule). Where a verifier already blocks or warns
  on something (e.g. `route-without-auth`, `db-error-to-client`), this doc
  explains the *positive* pattern to follow, and links to the verifier rule
  rather than restating its enforcement.
- Put the *actionable* part in every agent's context by default, and the
  reasoning one hop away — see "Discoverability" below.

## Non-goals

- Not a general architecture doc for the whole app (routing, component
  structure, Redux conventions) — those aren't the identified gap and already
  have de facto coverage via the feature-folder `CLAUDE.md`/`SKILL.md`
  pattern.
- Not a restatement of the SaaS migration's tenant-isolation rules — cross-
  referenced, not duplicated.
- Not the RPC migration itself — this doc states the *criteria* for when to
  reach for server-side aggregation; sub-project 2 does the actual design and
  migration.
- Not fixing the Appendix A findings — that is sub-project 3. This spec only
  records them so they survive.

## Deliverable

1. **`BACKEND_ARCHITECTURE_PRINCIPLES.md`** (new, **repo root**). Root, not
   `docs/` — every human/agent-facing doc in this repo lives at root
   (`AGENTS.md`, `SAAS_MIGRATION.md`, `AUDIT_2026-07-24.md`), while `docs/`
   currently holds only tool-generated output (`docs/graphify-out/`,
   `docs/superpowers/`). Matches the `SAAS_MIGRATION.md` precedent this doc
   is modelled on.
2. **The new-query checklist inlined into `AGENTS.md`** (~10 lines), plus a
   one-paragraph pointer to the full doc. See "Discoverability".
3. **Two new verifier rules** in `.claude/verifiers/`, with tests in
   `test_rules.py` and rows in the README rule table. See "Enforcement".

### Discoverability — what goes where, and why

`CLAUDE.md:1`'s `@AGENTS.md` is the only inlined include in the repo. A
pointer paragraph inside `AGENTS.md` therefore puts the new doc *one hop
past* the inclusion chain — exactly where `SAAS_MIGRATION.md` sits, and
agents routinely don't open that one. Inlining the whole principles doc into
the chain instead would cost every session's context for reasoning that is
only occasionally needed.

So the split is:

- **Inline in `AGENTS.md`**: section 6's checklist verbatim (~10 lines). It
  is the part that changes behaviour at the moment a query gets written, and
  it is cheap enough to carry in every session.
- **Behind the pointer, in the root doc**: sections 1–5, the reasoning,
  the worked examples, and the Appendix A findings reference.

The goal is *not* "every agent reads the whole doc" — it's "every agent has
the checklist in context, and the checklist tells them when to go read the
rest."

### Enforcement — the two verifier rules

Prose plus a checklist still relies on an agent choosing to apply it. These
two rules make the central invariant mechanical. Both are added to `RULES` in
`.claude/verifiers/rules.py` with `severity=WARN`, so they surface through
`verify_changes.py` (Stop hook / CLI / pre-commit) rather than blocking via
`guard_edit.py` — both have legitimate exceptions:

| Rule id | Fires on | Why WARN not DENY |
| --- | --- | --- |
| `unbounded-limit` | A `.limit(N)` with `N > 1000` — the literal PR #103 bug. The requested width is above the server cap, so it is silently a lie. | A deliberate "cap at N, truncation is fine" read is legitimate (`messagesSlice.ts`'s `SEARCH_RESULT_LIMIT`), so it needs `// verifier:allow`, not a block. |
| `unpaginated-collection-read` | A `.select()` on a known growth table (`sales`, `expenses`, `purchases`, `products`, `notifications`, `notification_reads`, `audit_logs`, `dropship_listings`, `platform_payouts`, `ebay_messages`, `ebay_listing_drafts`, `tenants`, `tenant_ai_usage`) with no `.range()`, `.single()`, `.maybeSingle()`, `.limit(1)`, `fetchAllRows`, or `.eq()` on an id column in the same statement. | Structurally-bounded reads on those tables exist and are fine; the table allowlist keeps false positives low but not zero. |

**Implementation constraint — the second rule cannot be a `pattern`.**
`Rule.pattern` matches a *single line* (see the `Rule` docstring in
`rules.py`), and this codebase's query style puts `.select()` and `.range()`
on different lines. So `unbounded-limit` is a plain single-line `pattern`,
but `unpaginated-collection-read` needs the `file_check` escape hatch with a
**new** handler that scans a statement window (the `.select(` line through
the next `;`) rather than one line. `file_check` currently has exactly one
handler, `_route_auth_finding` (`rules.py:403`), and it is *not* a model for
the window-scan logic itself — it does a whole-file presence/absence check
(`_DATA_ACCESS.search(text)` / `_AUTH_MARKERS.search(text)` over the entire
file text, no windowing at all). What it *does* establish is that
`file_check` is a real, working escape hatch for a rule too complex for a
single-line `pattern` — precedent for the mechanism, not a template for the
implementation. The windowed-scan handler for
`unpaginated-collection-read` is new code, not yet written. **Appendix A was
produced by manual/agent code review, not by running an existing verifier —
treat it as the fixture the new handler must reproduce (every listed site
should fire; the three "deliberate and correct" examples should not), not as
evidence the handler already exists.**

Baseline bookkeeping: `--all` currently reports **10 warnings, 0 blocking**
(7 × `db-error-to-client`, 3 × `no-any`). Adding these rules takes it to
**~23 warnings** until sub-project 3 closes the 13. The README's "Known
baseline" section must be updated in the same commit, or the next agent reads
a dirty baseline as a regression — which is exactly the failure mode that
section exists to prevent.

### Outline

1. **Data-fetching decision tree.** Four patterns, when each applies, and the
   Max Rows rule that motivates all of them:
   - Server-side paginated thunk (`fetchXPage` + `.select(..., {count:
     "exact"}).range(from, to)`) — the default for any list page a user pages
     through. Cites the seven existing implementations as the reference
     pattern: `fetchSalesPage`, `fetchExpensesPage`, `fetchPurchasesPage`,
     `fetchInventoryPage`, `fetchAuditLogsPage`, `fetchListingsPage`,
     `fetchMessagesPage`. (Note: AGENTS.md's "Pagination architecture"
     bullet currently lists only five — it predates Listings and Messages.
     Fixing that list is part of this deliverable, see "Single-sourcing".)
   - `fetchAllRows` (`src/lib/utils/fetchAllRows.ts`) — "I need every row
     matching a filter, up to a bounded safety cap" (CSV export, Overview's
     current aggregation). Explains *why* it exists: a single
     `.limit(N)`/`.range()` request is capped server-side by Supabase's
     PostgREST Max Rows setting (default 1000) regardless of the requested
     width, silently, with no error — so "fetch everything" must always be a
     loop, never a single call with a big number.
   - Plain unbounded fetch — acceptable ONLY for sets that are small by
     construction (a tenant's own `platform_connections`, a single-row
     `.maybeSingle()`/`.limit(1)` lookup) — not "small today," but
     structurally bounded (e.g. one row per platform per tenant, capped at
     the number of supported platforms). The doc states the test explicitly:
     *can you name the constant that bounds this set?* If the answer is a
     business-growth quantity (customers, orders, products, users), it is
     not bounded.
   - Postgres RPC aggregation — for read patterns that need a computed
     summary (sums, group-bys, top-N) rather than the rows themselves. Full
     criteria in section 2.
   - The rule stated plainly once, and referenced everywhere else in the doc
     instead of re-derived: **a client must never assume a requested
     `.limit()`/`.range()` width was honored** — always paginate when the
     true row count is unbounded, and use the response's actual row count to
     drive the next page (not the requested width), exactly as
     `fetchAllRows` does.

2. **Aggregation strategy — client-side vs. Postgres RPC.** A concrete
   threshold, not just "it depends": client-side aggregation (current
   Overview approach, `fetchAllRows` + in-memory reduce) stays acceptable
   while the bounded fetch cap (5000 rows per table) reliably covers a
   tenant's real data; once a tenant's row count *approaches* that cap, or
   the client is paying for a full-table download just to produce a handful
   of numbers, that's the signal to push into an RPC.

   **How anyone would actually know that happened.** As written today,
   `fetchAllRows` stops at its cap and returns silently — structurally the
   same failure mode as Max Rows, one order of magnitude up, and
   `tenant_k2_textil` is already at 1510 sales and growing. A threshold
   nobody can observe is not a threshold, so this deliverable also adds cap
   instrumentation: `fetchAllRows` already receives `count` from the first
   page, so when `total > cap` it logs a structured
   `console.warn("[fetchAllRows] cap reached", { cap, total })`. That is a
   deliberately minimal change — not a throw, which would turn a degraded
   Overview into a broken one — and it gives sub-project 2 a real signal for
   urgency instead of a guess.

   Names the tradeoff sub-project 2 will have to make explicit: an RPC
   duplicates business logic (revenue/VAT/exclusion rules) into SQL, which
   then has two places to keep in sync — this doc flags that cost so
   sub-project 2's spec has to address it, not silently accept it.

3. **N+1 avoidance.** Batch via `.in()`/`.upsert()` — cites
   `integrations/review/import` and `listings/ebay/sync` as existing good
   examples, and `ImportSalesModal.tsx`'s `IN_CHUNK` loop as the reference
   for chunking a large `.in()` list. Names the one structural exception
   found in the audit (the account-deletion webhook's per-tenant loop) and
   why schema-per-tenant multi-tenancy makes it unavoidable without a
   cross-schema batching mechanism this app doesn't have — the point isn't
   "never loop," it's "loop deliberately, not by accident."

   Also names the interaction that produced two Appendix A correctness bugs:
   **a batched `.in()` read is still an unbounded read.** Batching fixes the
   round-trip count, not the row cap. `.in(...)` over 1500 ids returns 1000
   rows, and the 500 missing ones look like "not found" to the caller.

4. **API route conventions.** The guard pattern already used by
   `src/lib/{billing,integrations,shipping,ai}/authGuard.ts`. The guards are
   **not** uniformly named `requireXAdmin()` — they are
   `requireBillingAdmin()`, `requireIntegrationAdmin()`,
   `requireShippingLabelAccess()` and `requireAiAccess()`; the doc names them
   individually rather than implying a naming convention that doesn't hold.

   The return shape must be documented exactly, because the abbreviated
   version does not type-check:

   ```ts
   export type BillingAuthResult =
     | { context: BillingAuthContext; error?: undefined }
     | { context?: undefined; error: NextResponse };
   ```

   The `?: undefined` on each branch is load-bearing, not decoration: it is
   what makes `if (auth.error) return auth.error;` narrow the union so
   `auth.context` is non-optional on the next line. Writing the intuitive
   `{ error: NextResponse } | { context: T }` instead compiles at the
   declaration and then fails at every use site. The doc shows the real
   shape and says why.

   Never return a raw Postgres/Supabase error message to the client (links
   `db-error-to-client`). New mutating routes should have a guard; new
   read-only routes should still authenticate via the tenant-scoped
   Supabase client's RLS rather than skip the question.

5. **Multi-tenant DDL recap (pointer only).** One paragraph pointing at
   AGENTS.md's `run_on_all_tenant_schemas` rule and `supabase/SKILL.md`'s
   "2-places" rule, stated so section 2's RPC guidance doesn't contradict it
   — any new aggregation function is DDL and must go through the same
   mechanism as any other tenant-schema change.

6. **New-query checklist.** A short, literal, skimmable checklist an agent
   can run through when writing any new Supabase query — the actionable
   summary of sections 1–4, meant to be read in 30 seconds before writing a
   query, not the first place someone learns the reasoning. **This section is
   the one that also gets inlined into `AGENTS.md`** (see "Discoverability"),
   so it must be written to stand alone without the surrounding sections.

### Single-sourcing — what moves, what stays

"Complement, not duplicate" has to name specific text, or the new doc becomes
a fourth place the pagination story is told. AGENTS.md itself records the
lesson from the 2026-07-24 audit: *"do not duplicate a specific list here, it
will drift out of sync."* Concretely:

| Existing text | Disposition |
| --- | --- |
| AGENTS.md "Pagination architecture (Phase 3)" bullet | **Moves** into section 1 (it is the reference-pattern description), corrected to seven thunks. AGENTS.md keeps a one-line pointer. |
| `src/lib/utils/fetchAllRows.ts` docblock | **Stays** — it is the API contract for the helper. Section 1 links to it rather than restating the mechanism. |
| Sales/Expenses/Purchases/Inventory `CLAUDE.md`'s "5 000-row cap" CSV descriptions | **Stay** — they are per-feature facts about that feature's export. Section 1 does not enumerate them; it states the pattern once and the feature docs remain the per-feature truth. |
| `src/app/dashboard/SKILL.md`'s Max Rows gotcha | **Stays**, re-pointed at the new doc instead of re-explaining the cap. |
| `.claude/verifiers/README.md` rule table | **Gains** the two new rows. The doc links to it; it does not restate enforcement. |

## Appendix A — recorded audit findings (re-run 2026-09-15)

Predicate: a `.select()` whose result set grows with tenant or platform data,
with no `.range()`, `fetchAllRows`, chunked `.in()`, `.single()`,
`.maybeSingle()`, `.limit(1)`, or id-equality filter. Verified by reading each
site. **Sub-project 3 fixes these; this spec only records them.**

**Correctness bugs** (wrong results, not just truncated display):

| # | Site | Failure past 1000 rows |
| --- | --- | --- |
| 1 | `src/app/api/integrations/review/import/route.ts:60` | Dedup `.in()` on `sales` returns a partial `existingByExtId`; `mergeImportedSale` then treats existing orders as new and **silently wipes user-owned fields on re-import**. |
| 2 | `src/app/api/integrations/review/route.ts:54` | Dedup set for the review list is partial, so already-imported orders **re-appear as new** and can be imported twice. |
| 3 | `src/app/api/dropshipping/listings/check-prices/route.ts:52` | Bulk price check silently examines only the first 1000 listings and **reports success** for the whole set. |
| 4 | `src/store/slices/notificationsSlice.ts:47` | `notification_reads` read is unbounded and unlimited; past 1000 reads, **already-read notifications resurface as unread**. |
| 5 | `src/store/slices/notificationsSlice.ts:58` | Low-stock source set truncated → **missed low-stock alerts** for products past the cap. |

**Display / completeness truncation:**

| # | Site | Effect |
| --- | --- | --- |
| 6 | `src/app/dashboard/layout.tsx:110` | Product selector (`id, name, current_stock, sku`, all rows) — incomplete product dropdowns in Add/Edit Sale, Purchase. |
| 7 | `src/app/dashboard/inventory/_store/inventorySlice.ts:72` | The refetch path for the same selector query — same bug, second location. Fix both together. |
| 8 | `src/app/dashboard/layout.tsx:139` | `dropship_listings` hydration truncated. |
| 9 | `src/app/dashboard/layout.tsx:144` | `platform_payouts` hydration truncated (Overview re-fetches these via `fetchAllRows`, so this affects store consumers, not the Overview cards). |
| 10 | `src/app/dashboard/layout.tsx:120` | `profiles` — structurally unbounded, small in practice (tens per tenant). Lowest severity; listed for completeness. |
| 11 | `src/app/api/dropshipping/listings/route.ts:21` | Listing list truncated. |
| 12 | `src/app/api/admin/tenants/route.ts:29` | Platform-wide tenant list truncated in `/admin`. |
| 13 | `src/app/api/admin/ai-usage/route.ts:31,40` | `tenant_ai_usage` grows per tenant × user × kind × period — the fastest-growing table here; admin AI usage figures **under-report**. |

Deliberate and correct, recorded so sub-project 3 doesn't "fix" them:
`ImportSalesModal.tsx:283` (chunks via `IN_CHUNK`), `messagesSlice.ts:84`
(explicit `SEARCH_RESULT_LIMIT`, truncation is the intended UX),
`ebay-account-deletion/route.ts:95` (tenant list, bounded by the tenant count
and the subject of section 3's N+1 exception).

Incidental, out of scope here: `api/dropshipping/listings/route.ts:26` and
`check-prices/route.ts:57` return raw `error.message` to the client — part of
the existing `db-error-to-client` baseline, not this audit.

## Self-review notes

- Scope check: one root doc + one AGENTS.md edit + a `fetchAllRows` warn line
  + two verifier rules with tests. Larger than the original single-file
  scope, but the verifier rules are the deliverable that makes the doc stick.
  One is a plain single-line `pattern` (existing machinery, no new code);
  the other reuses the `file_check` escape hatch (currently exercised only by
  `_route_auth_finding`, which is whole-file presence/absence, not a
  windowed scan) but needs a genuinely new handler and its own test
  fixtures. No new subsystem, but real new logic — still one implementation
  plan, just not a trivial one.
- No placeholders — every section above states its actual content, not "TBD."
- Consistency check: section 2's RPC-vs-client threshold and section 5's DDL
  pointer were written together specifically so they don't contradict (RPC
  guidance doesn't imply bypassing `run_on_all_tenant_schemas`).
- Consistency check: section 1's "structurally bounded" test, the
  `unpaginated-collection-read` table allowlist, and Appendix A's predicate
  are the same rule stated three times for three audiences (prose, code,
  evidence). If one changes, all three change.
- The relationship to sub-projects 2 and 3 is stated once (Problem section)
  and not repeated with different framing elsewhere in this spec.
- Appendix A exists because the finding list was previously session-only.
  Recording it here — in the artifact sub-project 3 will already be reading —
  was cheaper than a separate audit file that would need its own pointer.
