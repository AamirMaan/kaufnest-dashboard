# Project verifiers

Automated enforcement of the invariants that AGENTS.md, `supabase/SKILL.md` and
the 2026-07-24 audit state in prose. Prose does not fail a build; these do.

## Why this exists

The repo already had two quality gates, and neither covers this ground:

| Gate | Runs | Catches |
| --- | --- | --- |
| `.husky/pre-commit` | `tsc --noEmit`, `eslint` | type errors, style |
| `.husky/pre-push` | `jest`, `next build` | behaviour, build breakage |
| **these verifiers** | PreToolUse + Stop + pre-commit | **tenant isolation, secret boundaries, Stripe ownership, API auth** |

A `public.*` query, a service-role key read from a Client Component, or a
migration that hardcodes one tenant's schema are all perfectly valid TypeScript.
They type-check, they lint, they build, and they ship a multi-tenant data leak.

## Files

| File | Role |
| --- | --- |
| `rules.py` | The rule set + scanner. Single source of truth for "what counts as bad code here". |
| `guard_edit.py` | PreToolUse hook. Denies a Write/Edit that trips a BLOCK rule, before it lands. |
| `verify_changes.py` | Reporter. Stop hook, CLI, and pre-commit gate. |
| `test_rules.py` | Test suite — a positive *and* negative case per rule. |

## Running it

```bash
uv run .claude/verifiers/verify_changes.py            # the current diff
uv run .claude/verifiers/verify_changes.py --all      # every tracked file
uv run .claude/verifiers/verify_changes.py --staged --block-only   # what pre-commit runs
uv run .claude/verifiers/verify_changes.py --json     # machine-readable
uv run .claude/verifiers/test_rules.py                # the test suite
```

## Severities

**BLOCK** — denied at the PreToolUse hook and fails `pre-commit`. Reserved for
things that leak credentials or cross a tenant boundary. A clean tree reports
zero of these; if one appears, it is a real defect, not a style opinion.

**WARN** — reported by the Stop hook and by the CLI, never blocking. These are
judgement calls (`any`, a leaked Postgres error message) where a human decides.

## Rule set

| ID | Sev | What it catches |
| --- | --- | --- |
| `secret-literal` | BLOCK | Hardcoded Anthropic/Stripe/GitHub key or a JWT-shaped literal |
| `secret-env-assignment` | BLOCK | `CLIENT_SECRET = "…"` and friends assigned inline |
| `public-schema-query` | BLOCK | `.schema("public")` / `.from("public.…")` — AGENTS.md rule 1 |
| `server-module-in-client` | BLOCK | `@/lib/supabase/{server,control}`, `@/lib/integrations/*`, `stripe` imported from a `"use client"` file — AGENTS.md rule 3 |
| `server-secret-in-client` | BLOCK | Non-`NEXT_PUBLIC_` env var read in a Client Component |
| `middleware-file` | BLOCK | Creating `src/middleware.ts` — crashes the dev server; use `src/proxy.ts` |
| `hardcoded-tenant-schema` | WARN | `"tenant_<slug>"` literal in `src/` — AGENTS.md rule 2 |
| `migration-hardcodes-schema` | WARN | New migration doing DDL on one schema instead of `run_on_all_tenant_schemas` — AGENTS.md rule 5 |
| `plan-write-outside-webhook` | WARN | `tenants.plan` written outside the Stripe webhook — AGENTS.md rule 4 |
| `db-error-to-client` | WARN | Raw Postgres `error.message` returned to the client — audit 2.7 |
| `route-without-auth` | WARN | Route handler reaching Supabase with no auth guard — audit 2.1 |
| `ts-escape-hatch` | WARN | `@ts-ignore` / `@ts-nocheck` |
| `no-any` | WARN | Explicit `any` outside tests |
| `dangerous-html` | WARN | `dangerouslySetInnerHTML` (eBay listing/message bodies are untrusted) |
| `console-log` | WARN | Leftover `console.log` |

## Suppressing a rule

Put the marker on the offending line, with a reason:

```ts
const s = "tenant_kaufnest"; // verifier:allow hardcoded-tenant-schema — KaufNest-only table
```

Or on the line **immediately above**, like `eslint-disable-next-line`. Use this
where a trailing comment has nowhere legal to go — inside a JSX opening tag, or
mid-way through a multi-line SQL statement:

```tsx
<script
  // verifier:allow dangerous-html — static literal, no interpolation
  dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
/>
```

```sql
-- verifier:allow migration-hardcodes-schema
ALTER TABLE tenant_kaufnest.dropship_listings ADD COLUMN …;
```

Comma-separate multiple ids (`// verifier:allow no-any, console-log`).

Suppression reaches exactly one line — the marked line, or the one directly
after it. It never widens to the rest of the file, and a marker two lines up
does not apply.

`test_rules.py` is exempt from `secret-literal`: its fixtures are fake
credentials by definition, so without the exemption the guard would block every
edit to its own tests.

## Known baseline

`--all` currently reports 10 warnings and **zero blocking findings**:

- 7 × `db-error-to-client` — open audit finding 2.7, not yet remediated.
- 3 × `no-any` in `src/lib/utils/generateInvoice.ts` — jsPDF ships no usable
  `doc` type.

Keep the blocking count at zero. If a new BLOCK finding appears, fix the code
rather than the rule — the rules were calibrated against a clean tree at
`bafa506`, so a new one means something genuinely regressed.

## Adding a rule

1. Add a `Rule(...)` to `RULES` in `rules.py`. Fill in `why` — a rule whose
   rationale isn't written down gets deleted by the next person who trips it.
2. Add a positive **and** a negative case to `CASES` in `test_rules.py`. The
   negative case is the important one: it proves the rule doesn't fire on the
   legitimate code sitting next to the violation.
3. Run `uv run .claude/verifiers/verify_changes.py --all` and confirm you
   haven't added noise to the baseline.
4. Add the row to the rule-set table above.
