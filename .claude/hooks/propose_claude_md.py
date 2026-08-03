"""Stop hook: notice when a turn's changes might have staled a CLAUDE.md/SKILL.md.

Cheap and deterministic — no LLM call here. It collects the turn's changed
paths, maps them onto folders that own a CLAUDE.md or SKILL.md, and if any were
touched, hands off to reflect_claude_md.py (which makes the actual judgment
call) as a detached background process so this hook returns immediately.

Guards, in the order they fire:
  * CLAUDE_MD_REFLECT_LOCK — set by this hook on the child; if it is already
    set, this process *is* the child and must not re-trigger.
  * Nothing changed — no diff, no untracked files, nothing to review.
  * Docs-only change — Claude just updated CLAUDE.md/SKILL.md, which is the
    intended end state, not drift.
  * Fingerprint file — skips a change set already reviewed.
  * Missing `uv` — falls back to a static note instead of crashing.

Run manually: uv run .claude/hooks/propose_claude_md.py
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _areas import (  # noqa: E402
    areas_touched_by,
    changed_paths,
    governed_areas,
    is_doc_only,
    repo_root,
)

FINGERPRINT_FILE = ".claude/.claude_md_review_fingerprint"
REVIEW_FILE = ".claude/claude-md-review.md"
LOCK_VAR = "CLAUDE_MD_REFLECT_LOCK"


def fingerprint_of(diff: str, changed: list[str]) -> str:
    """Identify this change set by content *and* file list.

    Untracked files contribute no diff text, so hashing the diff alone would
    treat "added three new components" as identical to "changed nothing".
    """
    payload = diff + "\n".join(changed)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def main() -> None:
    if os.environ.get(LOCK_VAR):
        sys.exit(0)

    # Stop hooks receive session JSON on stdin — read and discard it.
    try:
        json.load(sys.stdin)
    except Exception:
        pass

    root = repo_root()
    if root is None:
        sys.exit(0)

    changed = changed_paths(root)
    if not changed or is_doc_only(changed):
        sys.exit(0)

    touched = areas_touched_by(changed, governed_areas(root))
    if not touched:
        sys.exit(0)

    diff = subprocess.run(
        ["git", "diff", "HEAD"], capture_output=True, text=True, cwd=root
    ).stdout

    fingerprint = fingerprint_of(diff, changed)
    stamp = root / FINGERPRINT_FILE
    if stamp.is_file() and stamp.read_text(errors="replace").strip() == fingerprint:
        sys.exit(0)

    child_env = os.environ.copy()
    child_env[LOCK_VAR] = "1"
    child_env["CLAUDE_MD_REFLECT_AREAS"] = json.dumps(touched)
    child_env["CLAUDE_MD_REFLECT_FINGERPRINT"] = fingerprint
    child_env["CLAUDE_MD_REFLECT_CHANGED"] = json.dumps(changed)

    reflector = root / ".claude" / "hooks" / "reflect_claude_md.py"
    try:
        subprocess.Popen(
            ["uv", "run", str(reflector)],
            env=child_env,
            cwd=root,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        (root / REVIEW_FILE).write_text(
            "# Doc Drift Review\n\n"
            "*`uv` not found on PATH — no automated review ran. Re-check the "
            f"CLAUDE.md/SKILL.md of these areas manually: {', '.join(touched)}*\n",
            encoding="utf-8",
        )
        # Stamp anyway: without `uv` the next turn would rewrite this same note
        # forever, and the message is already on screen for the user.
        stamp.write_text(fingerprint, encoding="utf-8")


if __name__ == "__main__":
    main()
