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
given query. A follow-up audit
(this session, unrecorded elsewhere) found ~8 more spots with the same class
of unbounded-fetch exposure across `dashboard/layout.tsx`, Inventory's
product-selector dropdown, the Dropshipping API, the Integrations review
dedup query (a latent correctness bug, not just display truncation), Admin's
platform-wide `listUsers`, and the account-deletion webhook.

This is the first of three sub-projects addressing that gap, in this order:

1. **This spec** — a backend/data-fetching architecture principles doc, so
   future work (including sub-projects 2 and 3) has a shared vocabulary and
   decision framework instead of ad hoc judgment calls.
2. Overview RPC aggregation rewrite (separate spec) — replaces
   `fetchAllRows`-based client aggregation on the Overview page with
   Postgres-side aggregation functions across all 5 live tenant schemas.
3. Audit-fix pass (separate spec) — applies this doc's decision framework to
   close the ~8 found gaps.

Sub-projects 2 and 3 are out of scope for this spec — they get their own
design docs once this one lands, and will cite it rather than re-litigate it.

## Goals

- Give future agents (and human contributors) a decision framework for
  choosing a data-fetching pattern, so the Max Rows class of bug doesn't
  recur in a new feature.
- Cover backend conventions more broadly, per explicit request: aggregation
  strategy (client vs. Postgres RPC), N+1 avoidance, API route auth-guard and
  error-response conventions.
- Complement, not duplicate, existing enforcement (`.claude/verifiers/`) and
  existing prose (AGENTS.md's "Key rules", `supabase/SKILL.md`'s
  `run_on_all_tenant_schemas` rule). Where a verifier already blocks or warns
  on something (e.g. `route-without-auth`, `db-error-to-client`), this doc
  explains the *positive* pattern to follow, and links to the verifier rule
  rather than restating its enforcement.
- Be discoverable by every agent working in this repo without a special
  trigger — reached via the same `@AGENTS.md` inclusion chain already in
  `CLAUDE.md`, not a skill or a file an agent has to know to go looking for.

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

## Deliverable

`docs/BACKEND_ARCHITECTURE_PRINCIPLES.md` (new, repo root `docs/`), plus a
short pointer paragraph added to `AGENTS.md` — same pattern as the existing
`SAAS_MIGRATION.md` reference ("The full plan is in `SAAS_MIGRATION.md` —
read it before touching auth...").

### Outline

1. **Data-fetching decision tree.** Four patterns, when each applies, and the
   Max Rows rule that motivates all of them:
   - Server-side paginated thunk (`fetchXPage` + `.select(..., {count:
     "exact"}).range(from, to)`) — the default for any list page a user pages
     through. Cites the existing Sales/Expenses/Purchases/Inventory/
     Audit-Logs/Listings/Messages implementations as the reference pattern.
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
     the number of supported platforms).
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
   of numbers, that's the signal to push into an RPC. Names the tradeoff
   sub-project 2 will have to make explicit: an RPC duplicates business logic
   (revenue/VAT/exclusion rules) into SQL, which then has two places to keep
   in sync — this doc flags that cost so sub-project 2's spec has to address
   it, not silently accept it.

3. **N+1 avoidance.** Batch via `.in()`/`.upsert()` — cites
   `integrations/review/import` and `listings/ebay/sync` as existing good
   examples. Names the one structural exception found in the audit (the
   account-deletion webhook's per-tenant loop) and why schema-per-tenant
   multi-tenancy makes it unavoidable without a cross-schema batching
   mechanism this app doesn't have — the point isn't "never loop," it's
   "loop deliberately, not by accident."

4. **API route conventions.** The `requireXAdmin()` guard pattern already
   used by `src/lib/{billing,integrations,shipping,ai}/authGuard.ts` — a
   `Promise<{ error: NextResponse } | { context: T }>` shape, checked with
   `if (auth.error) return auth.error;` as the first line of the handler.
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
   query, not the first place someone learns the reasoning.

## Self-review notes

- Scope check: single doc, single deliverable file + one AGENTS.md pointer
  paragraph — fits one implementation plan.
- No placeholders — every section above states its actual content, not "TBD."
- Consistency check: section 2's RPC-vs-client threshold and section 5's DDL
  pointer were written together specifically so they don't contradict (RPC
  guidance doesn't imply bypassing `run_on_all_tenant_schemas`).
- The relationship to sub-projects 2 and 3 is stated once (Problem section)
  and not repeated with different framing elsewhere in this spec.
