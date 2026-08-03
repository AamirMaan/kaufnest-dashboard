# `.claude/` — agent harness for this repo

Everything here configures how Claude Code behaves in this project. None of it
ships to users; all of it is checked in so every session (and every developer)
gets the same behaviour.

## Hook wiring (`settings.json`)

Every hook command `cd`s to the git toplevel first, so it behaves the same
whether Claude was started at the repo root or in a subfolder, and ends with
`|| true` so a broken hook degrades to a no-op instead of wedging the session.

| Event | Script | Does |
| --- | --- | --- |
| SessionStart | `hooks/session_start_context.py` | Branch (flagged if `main`), recent commits, which doc-governed areas have uncommitted work, any unread doc-drift review |
| PreToolUse `Write\|Edit\|MultiEdit` | `verifiers/guard_edit.py` | **Denies** a write that breaks a documented invariant |
| PreToolUse `Bash` | inline | Nudges toward `graphify query` before grep/find |
| PreToolUse `Read\|Glob` | inline | Nudges toward graphify before reading source |
| Stop | `verifiers/verify_changes.py --hook` | Reports security/standards findings in the turn's diff |
| Stop | `hooks/propose_claude_md.py` | Detects CLAUDE.md/SKILL.md drift, spawns the reflector |
| Stop | `hooks/refresh_graphify.py` | Rebuilds the graphify graph (AST-only, background) |

## Directories

| Path | What |
| --- | --- |
| `hooks/` | Session context, doc-drift detection, graphify refresh |
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
