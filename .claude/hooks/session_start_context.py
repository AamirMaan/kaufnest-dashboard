"""SessionStart hook — dynamic per-module orientation.

Prints a short orientation block at the start of every Claude Code session.
Claude Code injects this stdout into the session context, so Claude starts
already knowing which part of the codebase has active work — and the recent
direction of travel from git history — without spending a turn re-exploring.

Tested standalone: `uv run python .claude/hooks/session_start_context.py`
"""
import subprocess
import json
import sys
from pathlib import Path


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def find_claude_md_areas(root: Path) -> list[str]:
    areas = []
    for p in root.rglob("CLAUDE.md"):
        rel = p.parent.relative_to(root)
        parts = rel.parts
        if parts and parts[0] == ".claude":
            continue
        areas.append(str(rel))
    return sorted(areas)


def map_files_to_areas(files: list[str], areas: list[str]) -> list[str]:
    touched = set()
    for f in files:
        for area in areas:
            if f == area or f.startswith(area + "/"):
                touched.add(area)
    return sorted(touched)


def main():
    root_str = run(["git", "rev-parse", "--show-toplevel"])
    if not root_str:
        sys.exit(0)
    root = Path(root_str)

    branch = run(["git", "branch", "--show-current"]) or "detached HEAD"
    log = run(["git", "log", "--oneline", "-8"])
    changed = run(["git", "diff", "--name-only", "HEAD"]).splitlines()
    staged = run(["git", "diff", "--name-only", "--cached"]).splitlines()
    all_changed = list(dict.fromkeys(changed + staged))  # dedup, preserve order

    areas = find_claude_md_areas(root)
    active_areas = map_files_to_areas(all_changed, areas)

    lines = [f"Branch: {branch}"]
    if log:
        lines.append(f"Recent commits:\n{log}")
    if active_areas:
        area_list = "\n".join(f"  - {a}" for a in active_areas)
        lines.append(f"Active CLAUDE.md areas (uncommitted changes):\n{area_list}")
    else:
        lines.append("No uncommitted changes in CLAUDE.md-governed areas.")

    context = "\n\n".join(lines)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    }))


if __name__ == "__main__":
    main()
