@AGENTS.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- **The graph refreshes itself.** `graphify update .` runs automatically in the
  background (Stop hook, `.claude/hooks/refresh_graphify.py`) after any turn
  that changed extractable source — AST-only, no API cost. Do not run it by
  hand as a routine step. Two cases still need you: `graphify cluster-only .`
  after a large refactor (the auto-refresh skips re-clustering, so community
  labels drift), and `graphify update .` after changes made outside a session
  (a rebase, a colleague's merge).

Note: this project has no `graphify-out/wiki/`. Navigate via `query`/`explain`
or the per-feature `CLAUDE.md`/`SKILL.md` files instead.

## Verifiers

Project invariants (tenant isolation, the server/client secret boundary,
hardcoded credentials, Stripe plan ownership) are enforced by
`.claude/verifiers/` — a PreToolUse hook denies edits that break them, and a
Stop hook reports the softer findings. See `.claude/verifiers/README.md` for the
rule table and `AGENTS.md` → "Project verifier" for the rationale. If a write is
blocked, fix the code rather than working around the guard; if the rule is wrong
for your case, suppress that one line with `// verifier:allow <rule-id>`.
