"""Stop hook — the *trigger* half of the self-improving AI Layer.

After each Claude turn, checks which CLAUDE.md-governed areas were touched by
`git diff HEAD`, deduplicates via a diff fingerprint, and spawns the reflector
in the background if something new changed.

Three guards keep it well-behaved:
  * Recursion guard — HELPLINE_AILAYER_REFLECT_LOCK makes this no-op when set.
  * Dedup — fingerprint of `git diff HEAD` skips re-reflecting on a diff
    already handled this session.
  * Fallback — if `uv` is missing, exits cleanly without crashing.

Tested standalone: `uv run python .claude/hooks/propose_claude_md.py`
"""
import hashlib
import json
import os
import subprocess
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
    # Recursion guard
    if os.environ.get("HELPLINE_AILAYER_REFLECT_LOCK"):
        sys.exit(0)

    # Drain stdin (Claude Code sends session JSON to Stop hooks)
    try:
        _ = json.load(sys.stdin)
    except Exception:
        pass

    root_str = run(["git", "rev-parse", "--show-toplevel"])
    if not root_str:
        sys.exit(0)
    root = Path(root_str)

    diff = subprocess.run(["git", "diff", "HEAD"], capture_output=True, text=True).stdout
    if not diff.strip():
        sys.exit(0)

    # Dedup fingerprint
    fingerprint = hashlib.sha256(diff.encode()).hexdigest()[:16]
    stamp_file = root / ".claude" / ".last_reflect_hash"
    if stamp_file.exists() and stamp_file.read_text().strip() == fingerprint:
        sys.exit(0)

    # Find CLAUDE.md areas touched by the diff
    changed_files = run(["git", "diff", "--name-only", "HEAD"]).splitlines()
    areas = find_claude_md_areas(root)
    active_areas = map_files_to_areas(changed_files, areas)

    if not active_areas:
        sys.exit(0)

    # Spawn reflector in background
    env = os.environ.copy()
    env["HELPLINE_AILAYER_REFLECT_LOCK"] = "1"
    env["REFLECT_AREAS"] = json.dumps(active_areas)
    env["REFLECT_FINGERPRINT"] = fingerprint

    reflector = root / ".claude" / "hooks" / "reflect_claude_md.py"
    try:
        subprocess.Popen(
            ["uv", "run", str(reflector)],
            env=env,
            cwd=str(root),
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        # uv not on PATH — write a deterministic fallback note
        output = root / ".claude" / "claude-md-review.md"
        output.write_text(
            "# CLAUDE.md Review\n\n"
            f"*uv not found — re-check these areas manually: {', '.join(active_areas)}*\n"
        )


if __name__ == "__main__":
    main()
