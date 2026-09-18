# Backend & Data-Fetching Architecture Principles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `BACKEND_ARCHITECTURE_PRINCIPLES.md` plus the two verifier rules that enforce its central invariant (never trust a single `.limit()`/`.range()` to return everything it asked for), so the Max Rows truncation bug class (PR #103) doesn't recur and future audit/RPC work (sub-projects 2 and 3) has a shared vocabulary instead of ad hoc judgment calls.

**Architecture:** A root-level markdown doc (sections 1–6, cross-referencing existing verifiers/AGENTS.md rather than duplicating them) + a ~10-line checklist inlined into `AGENTS.md` + two new WARN-severity rules in `.claude/verifiers/rules.py` (one plain single-line `pattern`, one new `file_check` handler doing a windowed multi-line scan) + `fetchAllRows` cap-reached instrumentation. Every task lands on the existing branch `docs/backend-architecture-principles`.

**Tech Stack:** TypeScript (Next.js App Router, Supabase JS client), Python 3 (the verifier scanner, stdlib `re` only, no dependencies), Jest for TS tests, the repo's own `uv run .claude/verifiers/test_rules.py` for Python tests.

## Global Constraints

- Branch: `docs/backend-architecture-principles` (already created from `main`, two commits already on it: the spec and its correction). Do not create a new branch per task — commit each task directly to this branch.
- Every commit must pass `.husky/pre-commit` (`tsc --noEmit`, `eslint`, project verifier) — this is automatic on `git commit`, not a manual step.
- Per AGENTS.md's "Mandatory docs update" rule: any file map or shared-dependency change in a feature's `CLAUDE.md`/`SKILL.md` must land in the same commit as the code change, not a follow-up. Tasks below already fold doc updates into the task that needs them.
- No new npm dependencies. No new Python dependencies (the verifier suite is stdlib-only by existing convention — see `rules.py`'s imports).
- Follow the corrected spec at `docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md` exactly where it's explicit; where this plan makes an implementation-level judgment call the spec left open (documented inline in the relevant task), that judgment call is authoritative for review purposes.

## Implementation judgment calls (read before Task 2)

The spec's Enforcement section describes `unpaginated-collection-read`'s bounding markers as "`.range()`, `.single()`, `.maybeSingle()`, `.limit(1)`, `fetchAllRows`, or `.eq()` on an id column." Implementing this literally against the real codebase produces false positives on legitimate code the spec itself says must stay clean (Appendix A's "deliberate and correct" list). Three corrections, made while writing this plan and verified against the actual files:

1. **`.limit(N)` for any argument (not just literal `1`) counts as a bounding marker for `unpaginated-collection-read`.** `messagesSlice.ts:84`'s `.limit(SEARCH_RESULT_LIMIT)` must stay clean per the spec's own Appendix A, but `SEARCH_RESULT_LIMIT` is a named constant, not the literal `1`. Whether the size of that limit is *appropriate* is `unbounded-limit`'s job, not this rule's — a read with ANY explicit row cap is not what "unpaginated" means.
2. **`profiles` must be added to the growth-table allowlist.** The spec's Enforcement table lists 13 tables but omits `profiles`, yet Appendix A item #10 is a `profiles` read (`dashboard/layout.tsx:120`) that the spec says must fire. Without adding it to the allowlist, that Appendix A item can never trigger the rule.
3. **`unbounded-limit`'s literal-number regex has a real blind spot, worth documenting rather than hiding:** the original PR #103 bug in `dashboard/page.tsx` was `.limit(OVERVIEW_ROW_CAP)` — a named constant, not a literal `5000` — so a regex matching only literal digit arguments would NOT have caught that specific call site (it would have caught the three sibling bugs in Sales/Expenses/Purchases, which used literal `.limit(5000)`). Building constant-resolution into a WARN-severity textual heuristic is disproportionate (YAGNI) — Task 2 documents this limitation in the README rule row instead of silently overselling coverage.

One consequence of #1 and #2: three real files need an explicit `// verifier:allow unpaginated-collection-read` suppression comment added, because they are legitimately bounded in a way the mechanical rule can't see (a chunking loop one call up, or "bounded by platform-wide tenant count" business knowledge). Task 4 makes those edits. This matches the project's existing suppression convention (see `.claude/verifiers/README.md`'s "Suppressing a rule" section) rather than trying to make the regex arbitrarily clever.

---

### Task 1: `fetchAllRows` cap-reached instrumentation

**Files:**
- Modify: `src/lib/utils/fetchAllRows.ts`
- Test: `src/lib/utils/fetchAllRows.test.ts` (existing file — add cases)

**Interfaces:**
- Consumes: nothing new — same `fetchAllRows<T>(fetchPage, cap)` signature already in place.
- Produces: nothing new is exported. Behavior change only: logs `console.warn("[fetchAllRows] cap reached", { cap, total })` when the underlying collection's real row count exceeds `cap`. Later tasks (the doc, section 2) describe this as the observability signal for when to move a table to server-side RPC aggregation.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/utils/fetchAllRows.test.ts` (existing file, alongside its current 5 tests):

```ts
describe("fetchAllRows cap-reached warning", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns when the real row count exceeds the cap", async () => {
    const allRows = Array.from({ length: 6000 }, (_, i) => ({ id: i }));
    const fetchPage = serverCappedFetcher(allRows, 1000);

    await fetchAllRows(fetchPage, 5000);

    expect(warnSpy).toHaveBeenCalledWith("[fetchAllRows] cap reached", {
      cap: 5000,
      total: 6000,
    });
  });

  it("does not warn when the real row count is within the cap", async () => {
    const allRows = Array.from({ length: 1510 }, (_, i) => ({ id: i }));
    const fetchPage = serverCappedFetcher(allRows, 1000);

    await fetchAllRows(fetchPage, 5000);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
```

This reuses the existing `serverCappedFetcher` helper already defined at the top of the test file — no new import needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/utils/fetchAllRows -t "cap-reached"`
Expected: FAIL — `warnSpy` was never called in either case (the "does not warn" case currently passes vacuously; the "warns when" case fails because nothing calls `console.warn` yet). Confirm the first case's failure message shows zero calls.

- [ ] **Step 3: Implement the warning**

Edit `src/lib/utils/fetchAllRows.ts` — add the warning after the pagination loop, before `return results`:

```ts
  while (offset < Math.min(total, cap)) {
    const to = Math.min(offset + 999, cap - 1);
    const { data, error, count } = await fetchPage(offset, to);
    if (error || !data || data.length === 0) break;
    if (count != null) total = count;
    results.push(...data);
    offset += data.length;
  }

  if (total > cap) {
    console.warn("[fetchAllRows] cap reached", { cap, total });
  }

  return results;
```

Also update the function's docblock to mention the new behavior — append this sentence to the existing docblock, right before the `@param` lines:

```ts
 * When the real row count exceeds `cap`, logs a structured
 * `console.warn("[fetchAllRows] cap reached", { cap, total })` — this is
 * the signal that a table has outgrown client-side aggregation and a
 * caller (e.g. the Overview page) should move to server-side aggregation.
 * See BACKEND_ARCHITECTURE_PRINCIPLES.md section 2.
 *
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/utils/fetchAllRows`
Expected: PASS, all 7 tests (5 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/fetchAllRows.ts src/lib/utils/fetchAllRows.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): warn when fetchAllRows hits its overall cap

Gives sub-project 2 (Overview RPC rewrite) a real signal for when a
tenant's data has outgrown client-side aggregation, instead of the cap
silently absorbing growth the way Max Rows itself did before PR #103.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `unbounded-limit` verifier rule

**Files:**
- Modify: `.claude/verifiers/rules.py`
- Modify: `.claude/verifiers/test_rules.py`
- Modify: `.claude/verifiers/README.md`

**Interfaces:**
- Consumes: the existing `Rule` dataclass and `WARN` constant already defined in `rules.py`.
- Produces: a new rule id `"unbounded-limit"` registered in `RULES`, discoverable by `RULES_BY_ID["unbounded-limit"]` — Task 4 depends on this existing before it can compute the real baseline count.

- [ ] **Step 1: Write the failing test cases**

Add to the `CASES` list in `.claude/verifiers/test_rules.py`, right before the closing `]` of `CASES` (after the `"---- standards ----"` section, i.e. right before line 136's `]`):

```python
    # ---- scalability ----
    ("unbounded limit over the Max Rows default", "src/app/dashboard/x.tsx",
     'let q = supabase.from("sales").select("*").limit(5000);',
     "unbounded-limit"),
    ("limit at exactly 1000 still warns — no safety margin", "src/app/dashboard/x.tsx",
     'let q = supabase.from("sales").select("*").limit(1000);',
     "unbounded-limit"),
    ("small named-constant limit is fine", "src/app/dashboard/messages/_store/x.ts",
     'const q = supabase.from("ebay_messages").select("*").limit(SEARCH_RESULT_LIMIT);',
     None),
    ("limit(1) single-row lookup is fine", "src/lib/x.ts",
     'const q = supabase.from("sales").select("*").limit(1);', None),
    ("suppressed large limit", "src/app/dashboard/x.tsx",
     'let q = supabase.from("sales").select("*").limit(5000); // verifier:allow unbounded-limit',
     None),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run .claude/verifiers/test_rules.py`
Expected: FAIL on all 5 new cases — `unbounded-limit` doesn't exist yet, so every case expecting it reports "expected 'unbounded-limit', got nothing," and the "is fine" cases already pass vacuously (nothing fires yet). Confirm the failure count is exactly 2 (the two cases expecting `"unbounded-limit"` to fire — the other three already pass with no rule registered).

- [ ] **Step 3: Implement the rule**

In `.claude/verifiers/rules.py`, insert a new section between the end of the `route-without-auth` Rule (closes right before the `# ---- Code standards ----------------------------------------------------` comment) and that comment:

```python
    # ---- Data & scalability -------------------------------------------------
    Rule(
        id="unbounded-limit",
        severity=WARN,
        message=(
            "`.limit(N)` with N at or above 1000 is silently truncated by "
            "Supabase's PostgREST Max Rows setting (default 1000) regardless "
            "of what you asked for. Use fetchAllRows "
            "(src/lib/utils/fetchAllRows.ts) to page past it instead of one "
            "big .limit() call."
        ),
        why=(
            "PR #103: a .limit(5000) Overview/CSV-export query returned only "
            "1000 rows on a tenant with 1510 sales, with no error — see "
            "BACKEND_ARCHITECTURE_PRINCIPLES.md. Known gap: this only "
            "catches a literal numeric argument — `.limit(SOME_CONSTANT)` "
            "where SOME_CONSTANT resolves to >=1000 is invisible to a "
            "single-line regex (this was true of the actual "
            "`.limit(OVERVIEW_ROW_CAP)` bug in dashboard/page.tsx before the "
            "fix) — a human/agent review still matters for named constants."
        ),
        pattern=re.compile(r"\.limit\(\s*(\d{4,}|999[0-9]|100[0-9])\s*\)"),
        path_include=(r"^src/.*\.tsx?$",),
        path_exclude=(r"\.test\.tsx?$",),
        tags=("scalability",),
    ),
```

Note the pattern: `\d{4,}` matches any 4-or-more-digit literal (1000 and above, covering the common case), and `999[0-9]|100[0-9]` is redundant with `\d{4,}` and can be dropped — use just `\.limit\(\s*(\d{4,})\s*\)`. (Simplify to this single alternative — the plan's first draft above over-specified; `\d{4,}` alone already matches 1000 through any larger literal.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run .claude/verifiers/test_rules.py`
Expected: PASS on all 5 new cases (0 failures overall).

- [ ] **Step 5: Update the verifiers README**

Edit `.claude/verifiers/README.md` — add a row to the "Rule set" table (after the `console-log` row, since new rules append at the end per existing convention):

```markdown
| `unbounded-limit` | WARN | `.limit(N)` with N >= 1000 — Supabase's Max Rows setting truncates it silently regardless (PR #103) |
```

Do not update "Known baseline" yet — Task 4 does that once both new rules exist and `--all` has actually been run.

- [ ] **Step 6: Commit**

```bash
git add .claude/verifiers/rules.py .claude/verifiers/test_rules.py .claude/verifiers/README.md
git commit -m "$(cat <<'EOF'
feat(verifiers): add unbounded-limit rule for the Max Rows truncation class

WARN on any .limit(N) with a literal N >= 1000 — Supabase's PostgREST Max
Rows setting silently truncates such a request to its own cap regardless,
which is exactly the PR #103 bug. Known gap documented in the rule's `why`:
a named-constant argument (the actual shape of that bug in
dashboard/page.tsx) isn't caught by this single-line regex.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `unpaginated-collection-read` verifier rule

**Files:**
- Modify: `.claude/verifiers/rules.py`
- Modify: `.claude/verifiers/test_rules.py`
- Modify: `.claude/verifiers/README.md`

**Interfaces:**
- Consumes: `Rule`, `Finding`, `_suppressed` (all already defined in `rules.py`), and the `scan_text` dispatch loop's `file_check` branch pattern already established by `"route_auth"`.
- Produces: a new rule id `"unpaginated-collection-read"`, dispatched via `file_check == "unpaginated_collection_read"`, backed by a new handler function `_unpaginated_collection_read_finding`.

- [ ] **Step 1: Write the failing test cases**

Add to `.claude/verifiers/test_rules.py`, in the same `# ---- scalability ----` section added in Task 2 (append after the 5 `unbounded-limit` cases):

```python
    ("unpaginated read on control.tenants", "src/app/api/admin/tenants/route.ts",
     'const { data: tenants, error } = await control\n'
     '  .schema("control")\n'
     '  .from("tenants")\n'
     '  .select("*")\n'
     '  .order("created_at", { ascending: false });',
     "unpaginated-collection-read"),
    ("unpaginated read on notification_reads", "src/store/slices/notificationsSlice.ts",
     'supabase.from("notification_reads").select("notification_id"),',
     "unpaginated-collection-read"),
    ("unpaginated read on profiles", "src/app/dashboard/layout.tsx",
     'const { data: profiles } = await supabase.from("profiles").select("*");',
     "unpaginated-collection-read"),
    ("unbatched .in() dedup is still unbounded", "src/app/api/integrations/review/import/route.ts",
     'const { data: existingRows } = await client\n'
     '  .from("sales")\n'
     '  .select("*")\n'
     '  .in("external_order_id", extIds);',
     "unpaginated-collection-read"),
    ("paginated thunk with .range() is fine", "src/app/dashboard/sales/_store/salesSlice.ts",
     'let query = supabase\n'
     '  .from("sales")\n'
     '  .select("*", { count: "exact" })\n'
     '  .range(from, to);',
     None),
    ("single-row lookup with .eq id is fine", "src/lib/x.ts",
     'const { data } = await supabase.from("sales").select("*").eq("id", id).single();',
     None),
    ("small named-constant limit is fine (shared with unbounded-limit case)",
     "src/app/dashboard/messages/_store/x.ts",
     'const q = supabase.from("ebay_messages").select("*").limit(SEARCH_RESULT_LIMIT);',
     None),
    ("write (not a read) on a growth table is fine", "src/app/dashboard/admin/x.ts",
     'await c.from("tenants").update({ plan: "pro" }).eq("id", id);', None),
    ("suppressed chunked .in() read", "src/app/dashboard/sales/_components/ImportSalesModal.tsx",
     'const { data, error } = await supabase\n'
     '  .from("sales") // verifier:allow unpaginated-collection-read — chunked via IN_CHUNK above\n'
     '  .select("external_order_id")\n'
     '  .eq("platform", platform)\n'
     '  .in("external_order_id", chunk);',
     None),
    ("suppressed platform-wide tenant count read", "src/app/api/notifications/ebay-account-deletion/route.ts",
     'const { data: tenants } = await control\n'
     '  .schema("control")\n'
     '  .from("tenants") // verifier:allow unpaginated-collection-read — bounded by active tenant count\n'
     '  .select("schema_name")\n'
     '  .eq("status", "active");',
     None),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run .claude/verifiers/test_rules.py`
Expected: FAIL on the 4 cases expecting `"unpaginated-collection-read"` to fire (rule doesn't exist yet). The 6 "is fine"/write/suppressed cases already pass vacuously.

- [ ] **Step 3: Implement the rule**

In `.claude/verifiers/rules.py`, add the Rule entry right after `unbounded-limit` (same `# ---- Data & scalability ----` section from Task 2):

```python
    Rule(
        id="unpaginated-collection-read",
        severity=WARN,
        message=(
            "A .select() on a table that grows with tenant/platform data, "
            "with no .range(), .single()/.maybeSingle(), .limit(), "
            "fetchAllRows, or .eq() on an id column in the same statement. "
            "Supabase's PostgREST Max Rows setting silently truncates this "
            "at its cap (default 1000) once the table grows past it — see "
            "BACKEND_ARCHITECTURE_PRINCIPLES.md section 1."
        ),
        why=(
            "Appendix A of BACKEND_ARCHITECTURE_PRINCIPLES.md's design spec "
            "found 13 of these (5 are latent correctness bugs, not just "
            "display truncation) by manual review; this rule catches the "
            "next one automatically. The table list is deliberately an "
            "allowlist, not every table — it trades missing some growth "
            "tables for not flagging every small/reference table in the app."
        ),
        file_check="unpaginated_collection_read",
        path_include=(r"^src/.*\.tsx?$",),
        path_exclude=(r"\.test\.tsx?$",),
        tags=("scalability",),
    ),
```

Then, near the top of the file's constants section (right after `_DATA_ACCESS = re.compile(...)`, before `def _route_auth_finding`), add:

```python
# Tables whose row count grows with tenant/platform activity rather than a
# small, fixed set. Deliberately an allowlist — see the Rule's `why`.
_GROWTH_TABLES = (
    "sales", "expenses", "purchases", "products", "profiles",
    "notifications", "notification_reads", "audit_logs",
    "dropship_listings", "platform_payouts", "ebay_messages",
    "ebay_listing_drafts", "tenants", "tenant_ai_usage",
)
_TABLE_READ = re.compile(
    r'\.from\(\s*[\'"](' + "|".join(_GROWTH_TABLES) + r')[\'"]\s*\)'
)
# Any one of these appearing in the same statement window means the read is
# bounded. `.limit(` matches ANY argument (not just a literal 1) — whether
# the limit is the RIGHT size is unbounded-limit's job, not this one's.
_READ_BOUNDED = re.compile(
    r'\.range\(|\.single\(|\.maybeSingle\(|\.limit\(|fetchAllRows'
    r'|\.eq\(\s*[\'"]\w*[Ii]d[\'"]'
)
_STATEMENT_WINDOW_MAX_LINES = 20
```

Then add the handler function, right after `_route_auth_finding`:

```python
def _unpaginated_collection_read_finding(
    rule: Rule, rel_path: str, text: str
) -> list[Finding]:
    lines = text.splitlines()
    findings: list[Finding] = []
    for index, line in enumerate(lines):
        if not _TABLE_READ.search(line):
            continue
        window_end = index
        for offset in range(_STATEMENT_WINDOW_MAX_LINES):
            window_end = index + offset
            if window_end >= len(lines):
                window_end -= 1
                break
            if ";" in lines[window_end]:
                break
        window_lines = lines[index : window_end + 1]
        window_text = "\n".join(window_lines)
        # .update()/.delete()/.insert()/.upsert() on the same table is a
        # write, not an unpaginated read — out of scope for this rule.
        if ".select(" not in window_text:
            continue
        if _READ_BOUNDED.search(window_text):
            continue
        if any(_suppressed(lines, i, rule.id) for i in range(index, window_end + 1)):
            continue
        findings.append(
            Finding(rule=rule, path=rel_path, line_no=index + 1, line=line.strip())
        )
    return findings
```

Finally, wire the dispatch in `scan_text` — add a branch right after the existing `route_auth` branch:

```python
        if rule.file_check == "route_auth":
            findings.extend(_route_auth_finding(rule, rel_path, text))
            continue

        if rule.file_check == "unpaginated_collection_read":
            findings.extend(_unpaginated_collection_read_finding(rule, rel_path, text))
            continue
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run .claude/verifiers/test_rules.py`
Expected: PASS on all 10 new cases. If the "suppressed" cases still fire, check the trailing-comment placement lands on the exact line `_TABLE_READ` matched (the `.from(...)` line) — `_suppressed` only looks at that line and the one directly above it per call.

- [ ] **Step 5: Update the verifiers README**

Add a second new row to the "Rule set" table, right after `unbounded-limit`:

```markdown
| `unpaginated-collection-read` | WARN | `.select()` on a growth table (sales/expenses/profiles/tenants/…) with no `.range()`/`.single()`/`.limit()`/`.eq(id)`/`fetchAllRows` in the same statement |
```

- [ ] **Step 6: Commit**

```bash
git add .claude/verifiers/rules.py .claude/verifiers/test_rules.py .claude/verifiers/README.md
git commit -m "$(cat <<'EOF'
feat(verifiers): add unpaginated-collection-read rule

New file_check handler (rules.py's second, after route_auth) doing a
windowed multi-line scan: a .select() on a known growth table with no
.range()/.single()/.maybeSingle()/.limit()/fetchAllRows/.eq(id) anywhere
in the same statement fires. Modeled on route_auth only for the file_check
mechanism, not its whole-file presence/absence approach, which can't see a
multi-line statement's shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Apply the three real-file suppressions and compute the real baseline

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`
- Modify: `src/app/api/notifications/ebay-account-deletion/route.ts`
- Modify: `.claude/verifiers/README.md`

**Interfaces:**
- Consumes: the two rules from Tasks 2–3, now live in `RULES`.
- Produces: an accurate "Known baseline" section in the README that the next agent can trust — no other task depends on this one's outputs.

- [ ] **Step 1: Run the full-repo scan to see current findings**

Run: `uv run .claude/verifiers/verify_changes.py --all`

This will report the pre-existing 10 warnings (7 `db-error-to-client`, 3 `no-any`) plus every new hit from the two rules just added — expect somewhere around 20+ new findings (Appendix A's 13 known sites, the two suppression-needing sites before they're suppressed, plus additional legitimate hits the allowlist finds beyond Appendix A's original list, e.g. `api/admin/ai-usage/route.ts`'s `tenants` read). Read the full output — do not guess the count.

- [ ] **Step 2: Add the suppression comment to `ImportSalesModal.tsx`**

Find the chunked dedup query (around line 283–286) and add a trailing comment on the `.from("sales")` line:

```ts
          const { data, error } = await supabase
            .from("sales") // verifier:allow unpaginated-collection-read — chunked via IN_CHUNK above, each call is bounded to <=200 ids
            .select("external_order_id")
            .eq("platform", platform)
            .in("external_order_id", chunk);
```

- [ ] **Step 3: Add the suppression comment to `ebay-account-deletion/route.ts`**

Find the `cleanupEbayUser` function's tenants query (around line 91–96) and add a trailing comment on the `.from("tenants")` line:

```ts
  const { data: tenants } = await control
    .schema("control")
    .from("tenants") // verifier:allow unpaginated-collection-read — bounded by active tenant count, not per-tenant data growth
    .select("schema_name")
    .eq("status", "active");
```

- [ ] **Step 4: Re-run the full scan and record the real count**

Run: `uv run .claude/verifiers/verify_changes.py --all`

Confirm the two suppressed sites no longer appear. Count the total warnings reported. This number — not the spec's "~23" estimate — is what goes in the README.

- [ ] **Step 5: Update the README's "Known baseline" section**

Edit `.claude/verifiers/README.md`'s "Known baseline" section to read (filling in the *actual* counts from Step 4 — the bracketed placeholders below are exactly what must be replaced with real numbers, not left as-is):

```markdown
`--all` currently reports [N] warnings and **zero blocking findings**:

- 7 × `db-error-to-client` — open audit finding 2.7, not yet remediated.
- 3 × `no-any` in `src/lib/utils/generateInvoice.ts` — jsPDF ships no usable
  `doc` type.
- [X] × `unbounded-limit` / `unpaginated-collection-read` — the Appendix A
  findings recorded in
  `docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md`,
  not yet remediated (tracked as sub-project 3 of that spec's three-part
  plan). Two additional legitimate sites are suppressed with
  `// verifier:allow` (`ImportSalesModal.tsx`'s chunked dedup,
  `ebay-account-deletion/route.ts`'s tenant-count-bounded read).

Keep the blocking count at zero. If a new BLOCK finding appears, fix the code
rather than the rule — the rules were calibrated against a clean tree at
`bafa506` [update this hash reference only if the repo's convention is to
track it against the commit this task lands on — otherwise leave as-is],
so a new one means something genuinely regressed. The `unbounded-limit`/
`unpaginated-collection-read` count above is expected to shrink to 0 as
sub-project 3 lands, not stay flat — don't treat it as a new permanent
baseline the way the `db-error-to-client`/`no-any` counts are.
```

(Do not literally paste the bracketed meta-instruction about the commit hash into the file — resolve it: check what `bafa506` refers to via `git log --oneline | grep bafa506` or similar, and either keep the existing sentence unchanged if unsure, or drop the clause if it doesn't apply. The Appendix A count sentence is the real content to add.)

- [ ] **Step 6: Run the full verifier test suite and TS suite to confirm nothing regressed**

Run: `uv run .claude/verifiers/test_rules.py && npx jest`
Expected: both PASS (the Jest run should be unaffected by these changes — this is a regression check, not a new-test check).

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales/_components/ImportSalesModal.tsx src/app/api/notifications/ebay-account-deletion/route.ts .claude/verifiers/README.md
git commit -m "$(cat <<'EOF'
chore(verifiers): suppress the two legitimate unpaginated-collection-read hits, record the real baseline

ImportSalesModal's chunked IN_CHUNK dedup and the account-deletion
webhook's active-tenant-count read are both genuinely bounded in ways the
mechanical rule can't see. Suppressed with a reason, matching the existing
verifier convention, rather than complicating the regex to special-case
loop-bounded variables.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Write `BACKEND_ARCHITECTURE_PRINCIPLES.md`

**Files:**
- Create: `BACKEND_ARCHITECTURE_PRINCIPLES.md` (repo root)

**Interfaces:**
- Consumes: nothing code-level — this is a documentation deliverable. It references (by name/path, not by import) `fetchAllRows`, the `requireXAdmin()` guards, and the two new verifier rules from Tasks 1–3.
- Produces: the doc itself, which Task 6 links to from `AGENTS.md` and Task 7 links to from `dashboard/SKILL.md`. Sub-projects 2 and 3 (future work, out of scope here) will cite specific sections of this file by number, so **do not renumber sections 1–6 once this lands**.

- [ ] **Step 1: Create the file**

```markdown
# Backend & Data-Fetching Architecture Principles

This is the repo's decision framework for how data gets fetched, aggregated,
and served as tenant data grows — written after PR #103, where the Overview
page and three CSV exports silently computed their numbers from only the
first 1000 rows of a 1510-row table, with no error. See
`docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md`
for the full design rationale and the audit that produced this doc.

This doc complements, not duplicates, two things that already exist:
- `.claude/verifiers/README.md` — the enforced invariants (`unbounded-limit`
  and `unpaginated-collection-read` are the two this doc is about; the rest
  cover tenant isolation, secrets, and code standards).
- `AGENTS.md`'s "Key rules" and `supabase/SKILL.md`'s
  `run_on_all_tenant_schemas` rule — the multi-tenant DDL rules this doc's
  aggregation guidance (section 2) must never contradict.

For the 30-second version, see AGENTS.md's "New Supabase query checklist" —
it's the actionable summary of sections 1–4 below, kept in every agent's
context by default. Come here for the reasoning behind it.

## 1. Data-fetching decision tree

Every new Supabase query is one of these four shapes. Pick based on what the
caller actually needs, not habit.

**Server-side paginated thunk** — the default for any list a user pages
through (a table with Prev/Next, a searchable list). Shape:
`.select(..., { count: "exact" }).range(from, to)`, wired through a
`fetchXPage` Redux thunk that dispatches a `hydratePage` reducer. Seven
existing implementations to copy from: `fetchSalesPage`, `fetchExpensesPage`,
`fetchPurchasesPage`, `fetchInventoryPage`, `fetchAuditLogsPage`,
`fetchListingsPage`, `fetchMessagesPage`. Shared helpers:
`src/lib/utils/pagedQuery.ts` (`rangeFor`, `PageRequest`,
`DEFAULT_PAGE_SIZE = 50`) and `src/components/ui/Pagination.tsx`. Filters
(date range, status, currency, keyword search) are pushed into the query via
`.gte`/`.lte`/`.eq`/`.ilike` — never applied client-side after an unfiltered
fetch, which would silently miss anything not yet loaded into the current
page.

**`fetchAllRows`** (`src/lib/utils/fetchAllRows.ts`) — "I need every row
matching a filter, up to a bounded safety cap," not a page at a time. Used
today by the Overview page's four aggregation queries and the
Sales/Expenses/Purchases CSV exports, all capped at 5000 rows. This exists
because of the rule below — it pages through `.range()` calls internally,
advancing by each response's *actual* returned row count rather than the
requested width, so it self-adapts to whatever the server's real per-request
cap is.

**Plain unbounded fetch** — acceptable ONLY for a result set that is
structurally bounded, not just small today. The test: *can you name the
constant that bounds this set?* A tenant's own `platform_connections` is
bounded by the number of platforms this app integrates with (a handful,
fixed by this codebase's feature set). A `.eq("id", x).single()` lookup is
bounded by definition (one row). If the honest answer is a business-growth
quantity — customers, orders, products, users, notifications — it is NOT
bounded, even if today's tenants are all small. Use one of the other three
patterns instead.

**Postgres RPC aggregation** — for a read that needs a computed summary
(sums, group-bys, top-N) rather than the underlying rows. Full criteria in
section 2 below; no tenant-facing feature uses this today (Overview still
uses `fetchAllRows` + client-side reduce), but it's the documented next step
once a table outgrows the bounded-fetch cap.

**The rule underneath all four:** a client must never assume a requested
`.limit()`/`.range()` width was honored. Supabase's PostgREST "Max Rows" API
setting (Project Settings → API, default 1000) silently truncates ANY single
request to its own cap, regardless of what was asked for, with no error.
Confirmed live on `tenant_k2_textil`: a `.limit(5000)` request against 1510
`sales` rows returned `Content-Range: 0-999/1510`. This is why "fetch
everything" must always be a loop (`fetchAllRows`) that trusts the response's
actual size, never a single call with a big number.

**Known gap as of this writing:** `dashboard/layout.tsx`'s product-selector
dropdown query (`id, name, current_stock, sku`, all rows, no `.range()`) and
its `inventorySlice.ts` refetch twin are both plain unbounded fetches on a
table (`products`) that is NOT structurally bounded — a real violation of
this section's own rule, tracked for a future fix (see the verifiers'
"Known baseline" for the current count of open findings like this one; the
`unpaginated-collection-read` rule (below) flags it automatically).

## 2. Aggregation strategy — client-side vs. Postgres RPC

Client-side aggregation (fetch rows via `fetchAllRows`, reduce in memory —
the Overview page's current approach for revenue/VAT/net-profit/top-products)
stays acceptable WHILE the bounded fetch cap (5000 rows per table) reliably
covers a tenant's real data. The signal that it's stopped being acceptable is
observable, not a guess: `fetchAllRows` logs
`console.warn("[fetchAllRows] cap reached", { cap, total })` whenever a
table's real row count exceeds the cap it was given. `tenant_k2_textil` is
already at 1510 sales rows (30% of the 5000 cap) and growing from a two-month
import — this is the kind of number to watch.

When that signal fires (or a full-table download is clearly wasteful just to
produce a handful of summary numbers), the correct move is a Postgres RPC
function that computes the aggregate server-side and returns only the
numbers — not the rows. This is NOT free: it means porting business logic
(the revenue/VAT/exclusion rules currently in `_lib/aggregateSales.ts` and
`lib/utils/filters.ts`'s `isRevenueSale`) into SQL, creating two places
(TypeScript and SQL) that must agree on what counts as revenue. Any RPC
introduced this way is DDL and must go through `run_on_all_tenant_schemas` /
`provision_tenant_schema()` like any other tenant-schema change (section 5) —
it is not exempt from the "2-places" rule just because it's a function
instead of a table column.

## 3. N+1 avoidance

Batch via `.in()`/`.upsert()` rather than one query per row. Two existing
examples to copy: `integrations/review/import/route.ts`'s order upsert and
`listings/ebay/sync/route.ts`'s batched sync. When the `.in()` list itself
can be large, chunk it — `ImportSalesModal.tsx`'s `IN_CHUNK = 200` constant
and its `for (let i = 0; i < ids.length; i += IN_CHUNK)` loop is the
reference pattern.

**A batched `.in()` read is still subject to the Max Rows cap — batching
fixes the round-trip count, not the row cap.** `.in("external_order_id",
extIds)` over 1500 ids can still return only 1000 rows if nothing chunks the
IDS list itself; the 500 missing rows then look like "not found" to the
caller, which is a correctness bug, not just a display truncation one (see
`integrations/review/route.ts` and `integrations/review/import/route.ts` in
the verifiers' current findings — both fixed the eslint/type-check gate but
still need the actual chunking fix, tracked for sub-project 3).

One structural exception, not a violation: the account-deletion webhook
(`api/notifications/ebay-account-deletion/route.ts`) loops once per active
tenant issuing several Supabase calls each. Schema-per-tenant multi-tenancy
makes this unavoidable without a cross-schema batching mechanism this app
doesn't have — PostgREST can't join across `tenant_kaufnest.sales` and
`tenant_k2_textil.sales` in one request. The point isn't "never loop," it's
"loop deliberately, with the constraint named," which is why that loop has a
`// verifier:allow unpaginated-collection-read` comment explaining exactly
that, not a silent pass.

## 4. API route conventions

Every subsystem with mutating routes has its own guard function —
`requireBillingAdmin()`, `requireIntegrationAdmin()`,
`requireShippingLabelAccess()`, `requireAiAccess()`
(`src/lib/{billing,integrations,shipping,ai}/authGuard.ts`). They are not
uniformly named `requireXAdmin()` — check the actual export before assuming
the name.

The return shape matters and must be copied exactly, not approximated:

```ts
export type BillingAuthResult =
  | { context: BillingAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };
```

The `?: undefined` on each branch is load-bearing. It's what lets
`if (auth.error) return auth.error;` narrow the union so `auth.context` is
non-optional on the next line. The more "obvious" shape,
`{ error: NextResponse } | { context: T }` without the `?: undefined`
branches, type-checks at the declaration and then fails at every call site
that tries to narrow it — TypeScript can't discriminate a union whose
members don't share an optional-vs-present marker on the same keys.

Every new mutating route needs a guard, first line of the handler:
`const auth = await requireXGuard(); if (auth.error) return auth.error;`.
A new read-only route should still authenticate via the tenant-scoped
Supabase client's RLS rather than skip the question — RLS is not a
substitute for "does this route even check who's asking," it's the
second layer.

Never return a raw Postgres/Supabase error message to the client
(`return NextResponse.json({ error: error.message })` leaks schema
internals — see the `db-error-to-client` verifier rule). Log the real error
server-side, return a generic message to the client.

## 5. Multi-tenant DDL recap

Any new database function, including a Postgres RPC introduced per section
2, is DDL and follows the same rule as every other tenant-schema change: it
goes through `public.run_on_all_tenant_schemas($$ ... $$)`, never a literal
`ALTER TABLE tenant_kaufnest....` or `CREATE FUNCTION tenant_kaufnest....`
targeting one schema. It also needs the matching update to
`provision_tenant_schema()` in `005_tenant_provisioning.sql` so new tenants
get it too. See AGENTS.md's "Key rules" #5 and `supabase/SKILL.md`'s
"2-places" rule for the full detail — this section is a pointer, not a
restatement.

## 6. New Supabase query checklist

The actionable summary of sections 1–4 — this exact list is also inlined
into `AGENTS.md` so it's in every agent's context by default:

1. Is this a list a user pages through? Use a `fetchXPage` thunk:
   `.select(..., { count: "exact" }).range(from, to)`.
2. Do you need every row matching a filter, not just one page? Use
   `fetchAllRows` — never a single `.limit(N)` call, however big N is.
3. Is the result set structurally bounded (not just small today)? Name the
   constant that bounds it. A business-growth quantity (orders, users,
   products, notifications) is never bounded.
4. Do you need a computed summary rather than the rows themselves, and has
   `fetchAllRows` logged a cap-reached warning for this table? Consider a
   Postgres RPC (section 2) instead of fetching rows to reduce client-side.
5. Reading more than one id? Batch via `.in()`/`.upsert()`, chunked if the
   id list can be large (`IN_CHUNK` in `ImportSalesModal.tsx`). Remember: a
   batched `.in()` read is still subject to the Max Rows cap.
6. Writing a new mutating API route? Gate it with a `requireXGuard()`-style
   function (section 4) and never return a raw Postgres error to the client.

## Appendix A — recorded audit findings (2026-09-15)

Predicate: a `.select()` whose result set grows with tenant or platform data,
with no `.range()`, `fetchAllRows`, chunked `.in()`, `.single()`,
`.maybeSingle()`, `.limit()`, or id-equality filter in the same statement.
Verified by reading each site. The `unpaginated-collection-read` verifier
rule (`.claude/verifiers/rules.py`) now catches this class automatically —
run `uv run .claude/verifiers/verify_changes.py --all` for the current live
count, which may include sites beyond this list (the rule's table allowlist
is broader than what was manually reviewed here). **This list is a fixture
recording what prompted the rule; it is not fixed by this doc** — that's
sub-project 3 of `docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md`.

**Correctness bugs** (wrong results, not just truncated display):

| # | Site | Failure past 1000 rows |
| --- | --- | --- |
| 1 | `src/app/api/integrations/review/import/route.ts` | Dedup `.in()` on `sales` returns a partial `existingByExtId`; `mergeImportedSale` then treats existing orders as new and silently wipes user-owned fields on re-import. |
| 2 | `src/app/api/integrations/review/route.ts` | Dedup set for the review list is partial, so already-imported orders re-appear as new and can be imported twice. |
| 3 | `src/app/api/dropshipping/listings/check-prices/route.ts` | Bulk price check silently examines only the first 1000 listings and reports success for the whole set. |
| 4 | `src/store/slices/notificationsSlice.ts` (`notification_reads`) | Unbounded and unlimited; past 1000 reads, already-read notifications resurface as unread. |
| 5 | `src/store/slices/notificationsSlice.ts` (low-stock `products` query) | Truncated source set → missed low-stock alerts for products past the cap. |

**Display / completeness truncation:**

| # | Site | Effect |
| --- | --- | --- |
| 6 | `src/app/dashboard/layout.tsx` (product selector) | Incomplete product dropdowns in Add/Edit Sale, Purchase. |
| 7 | `src/app/dashboard/inventory/_store/inventorySlice.ts` (selector refetch) | Same bug, second location — fix both together. |
| 8 | `src/app/dashboard/layout.tsx` (`dropship_listings`) | Hydration truncated. |
| 9 | `src/app/dashboard/layout.tsx` (`platform_payouts`) | Hydration truncated (Overview itself re-fetches via `fetchAllRows`, so this affects store consumers, not the Overview cards). |
| 10 | `src/app/dashboard/layout.tsx` (`profiles`) | Structurally unbounded, small in practice (tens per tenant) — lowest severity, listed for completeness. |
| 11 | `src/app/api/dropshipping/listings/route.ts` | Listing list truncated. |
| 12 | `src/app/api/admin/tenants/route.ts` | Platform-wide tenant list truncated in `/admin`. |
| 13 | `src/app/api/admin/ai-usage/route.ts` | `tenant_ai_usage` grows per tenant × user × kind × period — the fastest-growing table here; admin AI usage figures under-report. |

Deliberate and correct, suppressed rather than fixed:
`ImportSalesModal.tsx` (chunks via `IN_CHUNK`, one call per chunk — see
section 3), `messagesSlice.ts` (explicit `SEARCH_RESULT_LIMIT`, truncation
is the intended search-results UX), `ebay-account-deletion/route.ts`
(tenant list bounded by active tenant count — see section 3's N+1
exception).
```

- [ ] **Step 2: Verify the doc builds no broken relative links / is valid markdown**

Run: `npx markdownlint-cli2 BACKEND_ARCHITECTURE_PRINCIPLES.md 2>&1 || true`

If `markdownlint-cli2` isn't installed in this repo (check `package.json` first — it's likely absent, since no other root doc appears to be linted), skip this check; there is no markdown lint gate in `.husky/pre-commit` today, so don't add one as a side effect of this task. Just proofread the file once by reading it back.

- [ ] **Step 3: Commit**

```bash
git add BACKEND_ARCHITECTURE_PRINCIPLES.md
git commit -m "$(cat <<'EOF'
docs: add BACKEND_ARCHITECTURE_PRINCIPLES.md

Data-fetching decision tree, aggregation strategy (client vs RPC), N+1
avoidance, API route conventions, and the Appendix A audit that motivated
the two new verifier rules. Implements the design in
docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update `AGENTS.md` — checklist + pointer, replace the Pagination architecture bullet

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `BACKEND_ARCHITECTURE_PRINCIPLES.md` from Task 5 (must exist first — this task links to it).
- Produces: nothing consumed by later tasks — this is the last content task before verification.

- [ ] **Step 1: Replace the "Pagination architecture (Phase 3)" bullet**

Find this bullet in `AGENTS.md` (under the "New shared code from the migration" list):

```markdown
- **Pagination architecture (Phase 3):** All main data tables use server-side
  pagination. Layout (`src/app/dashboard/layout.tsx`) hydrates page 1 with a
  row count via `.select("*", { count: "exact" }).range(0,
  DEFAULT_PAGE_SIZE - 1)` and passes `{data, count}` through `StoreProvider`
  → each slice's `hydratePage` reducer. Per-feature fetch thunks
  (`fetchSalesPage`, `fetchExpensesPage`, `fetchPurchasesPage`,
  `fetchAuditLogsPage`, `fetchInventoryPage`) handle subsequent pages and
  filter changes — filters are pushed into the Supabase query (`gte`, `lte`,
  `eq`, `ilike`), not applied client-side. Shared helpers:
  `src/lib/utils/pagedQuery.ts` (`rangeFor`, `PageRequest`,
  `DEFAULT_PAGE_SIZE = 50`) and `src/components/ui/Pagination.tsx`. Inventory
  has a split fetch: paginated `items` for the table + a lightweight
  full-fetch `selectorItems` (`id, name, current_stock, sku`) for product
  dropdowns in modals. Users and dropshipping listings use client-side
  pagination only (small data sets).
```

Replace it with:

```markdown
- **Pagination architecture (Phase 3):** All main data tables use
  server-side pagination via seven `fetchXPage` thunks. Full description —
  the reference pattern, the `.range()` shape, the shared helpers, and
  known gaps (Inventory's `selectorItems` full-fetch dropdown is NOT
  actually bounded, despite the name) — moved to
  `BACKEND_ARCHITECTURE_PRINCIPLES.md` section 1, to keep this list from
  drifting out of sync with that doc the way a duplicated list did before
  (see the 2026-07-24 audit note above this list).
```

- [ ] **Step 2: Add the new-query checklist + pointer paragraph**

Insert this as its own section right after the "Project verifier" section (before "## Keeping the graphify graph current") in `AGENTS.md`:

```markdown
## New Supabase query checklist

Full reasoning and the audit that motivated this: `BACKEND_ARCHITECTURE_PRINCIPLES.md`.
Before writing any new `.from(...).select(...)` call:

1. Is this a list a user pages through? Use a `fetchXPage` thunk:
   `.select(..., { count: "exact" }).range(from, to)`.
2. Do you need every row matching a filter, not just one page? Use
   `fetchAllRows` (`src/lib/utils/fetchAllRows.ts`) — never a single
   `.limit(N)` call, however big N is. Supabase's PostgREST "Max Rows"
   setting silently truncates any one request to its own cap (default
   1000), no error, regardless of the `.limit()`/`.range()` you asked for.
3. Is the result set structurally bounded (not just "small today")? Name
   the constant that bounds it. A business-growth quantity (customers,
   orders, products, users) is never bounded.
4. Do you need a computed summary (sums, group-bys, top-N) rather than
   rows? Consider a Postgres RPC instead of fetching rows to aggregate
   client-side (`BACKEND_ARCHITECTURE_PRINCIPLES.md` section 2).
5. Reading more than one id? Batch via `.in()`/`.upsert()`, chunked if the
   id list can be large (`IN_CHUNK` in `ImportSalesModal.tsx`) — and
   remember a batched `.in()` read is STILL subject to the Max Rows cap.
6. Writing a new mutating API route? Gate it with a `requireXGuard()`-style
   function (`src/lib/{billing,integrations,shipping,ai}/authGuard.ts`) and
   never return a raw Postgres error to the client.

Enforced by the `unbounded-limit` and `unpaginated-collection-read` rules
in `.claude/verifiers/` — see its README for the current count of open
findings.
```

- [ ] **Step 3: Verify the file still reads coherently**

Read `AGENTS.md` in full once after the edit — confirm no duplicate headings, no dangling references to the old bullet's content, and that the new section sits in a sensible place relative to "Project verifier" and "Keeping the graphify graph current."

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs(agents): add new-query checklist, point Pagination architecture at the new doc

Replaces the inline Pagination architecture bullet's detail (now in
BACKEND_ARCHITECTURE_PRINCIPLES.md section 1, avoiding the two-lists-drift
failure mode the 2026-07-24 audit already flagged once) with a pointer, and
adds the actionable checklist every agent now carries by default.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Point `dashboard/SKILL.md`'s Max Rows gotcha at the new doc

**Files:**
- Modify: `src/app/dashboard/SKILL.md`

**Interfaces:**
- Consumes: `BACKEND_ARCHITECTURE_PRINCIPLES.md` from Task 5.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Replace the gotcha's body**

Find the `### Gotcha: Supabase's PostgREST "Max Rows" setting silently truncates below your `.limit()`` section in `src/app/dashboard/SKILL.md` (added by the PR #103 fix). Replace its body with a pointer, keeping the heading:

```markdown
### Gotcha: Supabase's PostgREST "Max Rows" setting silently truncates below your `.limit()`

Full explanation, the decision framework for which fetch pattern to use, and
the current audit of other places this bites: `BACKEND_ARCHITECTURE_PRINCIPLES.md`
(sections 1 and Appendix A). Short version: a Supabase project's "Max Rows"
API setting (default 1000) caps every REST request's response at that many
rows regardless of the `.limit()`/`.range()` width requested, no error — use
`@/lib/utils/fetchAllRows`, not a bare `.limit(N)`, for "fetch everything
matching a filter." The 4 Overview queries in `page.tsx` and the
Sales/Expenses/Purchases CSV export queries all go through it already.
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/SKILL.md
git commit -m "$(cat <<'EOF'
docs(dashboard): point the Max Rows gotcha at BACKEND_ARCHITECTURE_PRINCIPLES.md

Keeps the gotcha discoverable from this feature's SKILL.md without
duplicating the full explanation now living in the new doc.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final verification, push, and PR

**Files:** none (verification only)

**Interfaces:** N/A — this task confirms everything from Tasks 1–7 is coherent together.

- [ ] **Step 1: Run the full TypeScript test suite**

Run: `npx jest`
Expected: PASS, all suites (should be 1060+ from before, plus the 2 new `fetchAllRows` tests from Task 1).

- [ ] **Step 2: Run the full verifier test suite**

Run: `uv run .claude/verifiers/test_rules.py`
Expected: PASS, 0 failures.

- [ ] **Step 3: Run typecheck and the full verifier scan**

Run: `npx tsc --noEmit && uv run .claude/verifiers/verify_changes.py --all`
Expected: `tsc` clean. Verifier reports the same count recorded in Task 4's README update — if it doesn't match, something changed between Task 4 and now; investigate before proceeding, don't just update the number again without understanding why.

- [ ] **Step 4: Confirm git state before pushing**

Run: `git log --oneline main..HEAD` and `git status --short`
Expected: 8 commits ahead of `main` (2 already there from the spec + this task's 6 implementation commits — the exact count depends on whether any step above needed a fixup commit), working tree clean.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin docs/backend-architecture-principles
```

```bash
gh pr create --title "docs: backend & data-fetching architecture principles + Max Rows verifier rules" --body "$(cat <<'EOF'
## Summary
- Adds `BACKEND_ARCHITECTURE_PRINCIPLES.md` — the decision framework for data-fetching patterns (server-paginated thunk / `fetchAllRows` / plain unbounded / Postgres RPC), aggregation strategy, N+1 avoidance, and API route conventions, written after PR #103's Max Rows truncation bug.
- Adds two new verifier rules (`unbounded-limit`, `unpaginated-collection-read`) that catch this bug class mechanically instead of relying on prose alone — see `.claude/verifiers/README.md` for the current count of open findings they surface (recorded as Appendix A in the design spec, to be fixed in a follow-up sub-project).
- Adds `fetchAllRows` cap-reached instrumentation (`console.warn`) so a future decision to move a table to server-side RPC aggregation has a real signal instead of a guess.
- Inlines a ~10-line "New Supabase query checklist" into `AGENTS.md` so it's in every agent's context by default; the Pagination architecture bullet there now points at the new doc instead of duplicating it.
- Suppresses 2 legitimate `unpaginated-collection-read` false positives (`ImportSalesModal.tsx`'s chunked dedup, the account-deletion webhook's tenant-count-bounded read) with `// verifier:allow` + a reason.

This is sub-project 1 of a three-part plan (see the design spec) — sub-project 2 (an Overview RPC aggregation rewrite) and sub-project 3 (fixing the ~13 Appendix A findings) are separate, not-yet-started follow-ups that will cite this doc rather than re-litigate it.

## Test plan
- [x] `npx jest` — full suite passing, including 2 new `fetchAllRows` cap-warning tests
- [x] `uv run .claude/verifiers/test_rules.py` — including 15 new test cases for the two new rules
- [x] `npx tsc --noEmit` clean
- [x] `uv run .claude/verifiers/verify_changes.py --all` — baseline recorded in `.claude/verifiers/README.md` matches the live count

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** Section 1 (decision tree) → doc Task 5. Section 2 (aggregation strategy + cap instrumentation) → Tasks 1 and 5. Section 3 (N+1) → doc Task 5, suppression in Task 4. Section 4 (API routes) → doc Task 5. Section 5 (DDL recap) → doc Task 5. Section 6 (checklist) → Tasks 5 and 6. Enforcement (two verifier rules) → Tasks 2–4. Discoverability (root doc + AGENTS.md pointer + inlined checklist) → Tasks 5–7. Appendix A → Task 5's doc content, sourced from the corrected spec.
- **Deviations from the spec, all flagged in "Implementation judgment calls" above and in the relevant task's rationale**, not silently made: `.limit()` bounding marker broadened to any argument, `profiles` added to the growth-table allowlist, `unbounded-limit`'s named-constant blind spot documented rather than solved.
- **Type/name consistency check:** `fetchAllRows`'s signature is unchanged from PR #103 (`fetchPage: (from, to) => Promise<{data, error, count}>`, `cap: number`) — Task 1 only adds a warning, no signature change, so nothing downstream (the Overview page, the three CSV exports) needs touching. Rule id strings (`unbounded-limit`, `unpaginated-collection-read`) are spelled identically everywhere they appear (Rule definition, file_check dispatch string, README rows, test case expectations, doc references) — double-checked when writing this plan.
