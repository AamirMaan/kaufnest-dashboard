# `.claude/` — agent harness for this repo

Everything here configures how Claude Code behaves in this project. None of it
ships to users; all of it is checked in so every session (and every developer)
gets the same behaviour.

## Hook wiring (`settings.json`)

Every hook command `cd`s to the git toplevel first, so it behaves the same
whether Claude was started at the repo root or in a subfolder, and ends with
`|| true` so a broken hook degrades to a no-op instead of wedging the session.
The one exception is `pr_review_gate.py`, which drops it so a broken gate is
reported instead of silently waving PRs through (any exit code but 2 is still
non-blocking), and which sits behind a shell `case` pre-filter instead of the
toplevel `cd` running unconditionally.

| Event | Script | Does |
| --- | --- | --- |
| SessionStart | `hooks/session_start_context.py` | Branch (flagged if `main`), recent commits, which doc-governed areas have uncommitted work, any unread doc-drift review |
| PreToolUse `Write\|Edit\|MultiEdit` | `verifiers/guard_edit.py` | **Denies** a write that breaks a documented invariant |
| PreToolUse `Bash` | inline | Nudges toward `graphify query` before grep/find |
| PreToolUse `Bash` | `hooks/pr_review_gate.py` | **Denies** `gh pr create` until HEAD has been reviewed by `/code-review` + the `pr-reviewer` agent, and always when combined with `cd`/`--head` |
| PreToolUse `Read\|Glob` | inline | Nudges toward graphify before reading source |
| Stop | `verifiers/verify_changes.py --hook` | Reports security/standards findings in the turn's diff |
| Stop | `hooks/propose_claude_md.py` | Detects CLAUDE.md/SKILL.md drift, spawns the reflector |
| Stop | `hooks/refresh_graphify.py` | Rebuilds the graphify graph (AST-only, background) |

## Directories

| Path | What |
| --- | --- |
| `hooks/` | Session context, doc-drift detection, graphify refresh |
| `agents/` | Project subagents — `pr-reviewer.md` reviews a PR/branch against AGENTS.md, the verifiers and feature docs |
| `verifiers/` | Project-invariant rules + enforcement — see `verifiers/README.md` |
| `settings.json` | Hook wiring (checked in) |
| `settings.local.json` | Per-developer secrets and permissions (**gitignored**) |

## `hooks/`

- **`_areas.py`** — shared git/area helpers. "Which folders own a
  CLAUDE.md/SKILL.md, and which of them did these changed paths touch." All
  three doc hooks import this so they cannot drift apart.
- **`session_start_context.py`** — orients a fresh session so it doesn't spend a
  turn re-deriving where it is.
- **`propose_claude_md.py`** — Stop hook. Cheap and deterministic: maps changed
  paths to doc-governed areas, then hands off to the reflector as a detached
  process. Fingerprints each change set so the same diff is never reviewed twice.
- **`reflect_claude_md.py`** — the reflector. Asks Claude Haiku whether the diff
  staled any CLAUDE.md/SKILL.md, writes the verdict to
  `.claude/claude-md-review.md`, which `session_start_context.py` surfaces next
  session. Needs `CLAUDE_MD_REFLECT_API_KEY` in `settings.local.json` → `env`.
- **`refresh_graphify.py`** — Stop hook. Runs `graphify update . --no-cluster`
  in the background when extractable source changed. Lock-guarded, with a
  15-minute staleness reclaim so a killed rebuild can't block future ones.
- **`pr_review_gate.py`** — PreToolUse `Bash` gate. When a command opens a PR
  (`gh pr create`/`gh pr new`, also after `if`/`then`/`!`/`{`, behind `env`/
  `command`/`time`/`sudo`, via a full path to `gh`, with global flags like
  `-R owner/repo`, or inside `$(…)`/backticks), it does one of two things:
  - **Plain PR command** → checks HEAD of the hook's `cwd`. No review marker →
    deny, telling Claude to run `/code-review` and the `pr-reviewer` agent,
    show you both reports, fix blockers, then run the `--mark` command the
    deny message prints. Markers are keyed by commit SHA under
    `<git-common-dir>/claude-pr-review/` (outside the work tree, shared by
    worktrees), so any commit after the review needs a fresh one.
  - **PR command plus a `cd`/`pushd` or `--head`/`-H` anywhere in the same
    command** → always denied, reviewed or not. The gate deliberately doesn't
    guess which commit such a command targets (two review rounds showed that
    means rebuilding a shell parser, badly). Claude's working directory persists
    between Bash calls, so the fix is always to `cd` in one call and run a plain
    `gh pr create` in the next — then the hook's `cwd` *is* the PR's source.
  - **What it ignores:** before matching, one scanner blanks everything the
    shell won't run as a command — quoted strings, `#` comments, heredoc bodies
    (only for `<<` outside quotes; `<<-` strips tabs, plain `<<` doesn't), and
    `$((…))` arithmetic — and joins `\`-newline continuations. `$(…)`/backticks
    stay visible even inside double quotes, because they run. So commit
    messages, `echo`, `grep` and test scripts that merely *mention*
    `gh pr create` pass, and an unclosed quote can't crash it.
  - **Cheap on ordinary commands:** the hook command in `settings.json` is a
    shell `case` that only starts Python when the payload contains `pr…create`
    or `pr…new`.
  - **It is a guardrail against forgetting the review, not a security
    boundary.** `--mark` is trusted — the gate can't prove the reviews ran.
    Uncommitted edits made after a review aren't covered. Deliberate evasion
    (`bash -c '…'`, `gh api …/pulls`, `xargs gh …`) isn't matched. It only
    gates Claude's own Bash calls; a PR you open from your own terminal is
    unaffected.
  - **Fails open, visibly.** If it can't check (the `cwd` isn't a git repo, an
    unexpected error) it lets the command through with a `systemMessage`
    warning. Unlike the other hooks it has no `2>/dev/null || true`, so a
    missing `python3` shows as a hook error rather than vanishing. Written for
    the macOS system Python (3.9) — keep `from __future__ import annotations`
    if you touch the type hints.
  - **Tests:** `python3 .claude/hooks/test_pr_review_gate.py` — positive and
    negative cases per matching rule (every case from both review rounds is in
    there, tagged r1/r2), a length-preservation check on the scanner, and
    end-to-end runs against a throwaway git repo.
  - **New agents need a session restart.** Claude Code loads `.claude/agents/`
    at session start, so a session that predates `pr-reviewer.md` can't call it
    by `subagent_type`; the deny message tells Claude to fall back to a
    general-purpose agent following that file.

### Why a dedicated API key variable

`reflect_claude_md.py` reads `CLAUDE_MD_REFLECT_API_KEY`, **not**
`ANTHROPIC_API_KEY`. Claude Code reads the latter for its own auth, so exporting
it session-wide would silently move the main session off subscription billing
and onto API credits. The reflector is the only thing that should spend there.

## Requirements

The Python hooks run under [`uv`](https://docs.astral.sh/uv/). If `uv` isn't on
PATH, every hook degrades to a no-op (and `.husky/pre-commit` skips the verifier
step) rather than failing — a fresh clone still works, it just loses the
automation until `uv` is installed.

## Scratch state (gitignored)

`claude-md-review.md`, `.claude_md_review_fingerprint`, `__pycache__/`, and
`graphify-out/.refresh.lock` are all per-machine and regenerated as needed.
