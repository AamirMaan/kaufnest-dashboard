"""SessionStart hook: orient a fresh session before it spends a turn exploring.

Emits, as `additionalContext` on the SessionStart event:
  * current branch (flagged when it is `main`, which AGENTS.md forbids
    committing to)
  * recent commit history
  * which CLAUDE.md/SKILL.md-governed feature folders have uncommitted work,
    and the exact doc files that pair with them
  * any unread doc-drift review left behind by `propose_claude_md.py`

That last section is what closes the loop: the Stop hook writes its findings to
`.claude/claude-md-review.md`, and without this nothing would ever read them.

Run manually: uv run .claude/hooks/session_start_context.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _areas import (  # noqa: E402
    area_doc_paths,
    areas_touched_by,
    changed_paths,
    git,
    governed_areas,
    repo_root,
)

RECENT_COMMIT_COUNT = 8
REVIEW_FILE = ".claude/claude-md-review.md"
REVIEW_CHAR_LIMIT = 1200
PROTECTED_BRANCH = "main"


def branch_section() -> str:
    branch = git("branch", "--show-current") or "(detached HEAD)"
    if branch == PROTECTED_BRANCH:
        return (
            f"Branch: {branch} — protected. Per AGENTS.md, create a working "
            "branch before committing anything."
        )
    return f"Branch: {branch}"


def active_areas_section(root: Path) -> str:
    touched = areas_touched_by(changed_paths(root), governed_areas(root))
    if not touched:
        return ""
    bullets = []
    for area in touched:
        docs = ", ".join(p.name for p in area_doc_paths(root, area)) or "(no docs yet)"
        bullets.append(f"  - {area}/ → {docs}")
    return (
        "Uncommitted work touches these governed areas (read their docs before "
        "editing, update them before finishing):\n" + "\n".join(bullets)
    )


def pending_review_section(root: Path) -> str:
    review = root / REVIEW_FILE
    if not review.is_file():
        return ""
    body = review.read_text(encoding="utf-8", errors="replace").strip()
    if not body or "No updates needed" in body:
        return ""
    if len(body) > REVIEW_CHAR_LIMIT:
        body = body[:REVIEW_CHAR_LIMIT] + "\n...[truncated]"
    return (
        f"Unresolved doc-drift review from a previous session ({REVIEW_FILE}) — "
        f"confirm or dismiss it before starting new work:\n{body}"
    )


def build_context(root: Path) -> str:
    sections = [branch_section()]
    commits = git("log", f"-{RECENT_COMMIT_COUNT}", "--oneline", cwd=root)
    if commits:
        sections.append(f"Recent commits:\n{commits}")
    sections.append(active_areas_section(root))
    sections.append(pending_review_section(root))
    return "\n\n".join(s for s in sections if s)


def main() -> None:
    root = repo_root()
    if root is None:
        sys.exit(0)

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": build_context(root),
        }
    }))


if __name__ == "__main__":
    main()
