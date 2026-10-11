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
non-blocking).

| Event | Script | Does |
| --- | --- | --- |
| SessionStart | `hooks/session_start_context.py` | Branch (flagged if `main`), recent commits, which doc-governed areas have uncommitted work, any unread doc-drift review |
| PreToolUse `Write\|Edit\|MultiEdit` | `verifiers/guard_edit.py` | **Denies** a write that breaks a documented invariant |
| PreToolUse `Bash` | inline | Nudges toward `graphify query` before grep/find |
| PreToolUse `Bash` | `hooks/pr_review_gate.py` | **Denies** `gh pr create` until HEAD has been reviewed by `/code-review` + the `pr-reviewer` agent |
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
  (`gh pr create`/`gh pr new`, also behind `cd x &&`, `then`, `env`/`command`/
  `time`, a full path to `gh`, global flags like `-R owner/repo`, or `$(…)`/
  backticks) and the commit it would open from has no review marker, it denies
  the call and tells Claude to run `/code-review` and the `pr-reviewer` agent,
  show you both reports, fix blockers, then run the exact `--mark` command the
  deny message prints.
  - **What it checks:** HEAD of the directory the PR is opened from — the
    hook's `cwd`, or the last `cd <dir>` before the command — or the
    `--head <branch>` branch if given. Markers are keyed by commit SHA under
    `<git-common-dir>/claude-pr-review/` (outside the work tree, shared by
    worktrees), so any commit after the review needs a fresh one.
  - **What it ignores:** heredoc bodies and quoted strings are blanked before
    matching, so commit messages, `echo`, `grep` and test scripts that merely
    *mention* `gh pr create` pass. `$(…)`/backticks inside double quotes do run,
    so those are still checked.
  - **It is a guardrail against forgetting the review, not a security
    boundary.** `--mark` is trusted — the gate can't prove the reviews ran.
    Uncommitted edits made after a review aren't covered. Deliberate evasion
    (`bash -c '…'`, `gh api …/pulls`) isn't matched. It only gates Claude's
    own Bash calls; a PR you open from your own terminal is unaffected.
  - **Fails open, visibly.** If it can't resolve the target (not a git repo, an
    unknown `--head` branch) it lets the command through with a
    `systemMessage` warning. Unlike the other hooks it has no
    `2>/dev/null || true`, so a missing `python3` or a crash shows as a hook
    error rather than vanishing. Written for the macOS system Python (3.9) —
    keep `from __future__ import annotations` if you touch the type hints.
  - **Tests:** `python3 .claude/hooks/test_pr_review_gate.py` — a positive and
    negative case per matching rule, plus end-to-end runs against throwaway
    git repos.
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
