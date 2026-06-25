# /// script
# dependencies = ["anthropic"]
# ///
"""Reflector — the *reasoning* half of the self-improving Stop hook.

`propose_claude_md.py` (the hook) does the cheap, deterministic part: notice
that something changed. This file does the expensive part:

    Gathers the session's working-tree diff plus the current CLAUDE.md of every
    area that changed, asks Claude Haiku to judge whether those conventions still
    hold, and writes the proposal to `.claude/claude-md-review.md`.

Because it makes an LLM call (slow), the hook spawns this in the background.
It can also be run directly for a synchronous reflection — that is what
validate_all.py and manual testing use:

    HELPLINE_AILAYER_REFLECT_LOCK=1 REFLECT_AREAS='["src/app/dashboard/sales"]' \\
        uv run .claude/hooks/reflect_claude_md.py

Two safety properties:
  * Recursion guard — only runs when HELPLINE_AILAYER_REFLECT_LOCK is set,
    so a headless `claude` spawned here cannot re-trigger this script.
  * Graceful fallback — if the Anthropic call fails, writes a deterministic
    "re-check these files" note so drift is flagged either way.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import anthropic


def run(cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd).stdout.strip()


def read_truncated(path: Path, limit: int) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        return text[:limit] + ("\n...[truncated]" if len(text) > limit else "")
    except Exception:
        return ""


def main():
    # Only run when spawned by propose_claude_md.py (recursion guard)
    if not os.environ.get("HELPLINE_AILAYER_REFLECT_LOCK"):
        sys.exit(0)

    areas: list[str] = json.loads(os.environ.get("REFLECT_AREAS", "[]"))
    fingerprint: str = os.environ.get("REFLECT_FINGERPRINT", "")

    root_str = run(["git", "rev-parse", "--show-toplevel"])
    if not root_str:
        sys.exit(0)
    root = Path(root_str)

    diff = subprocess.run(
        ["git", "diff", "HEAD"], capture_output=True, text=True, cwd=str(root)
    ).stdout

    # Gather CLAUDE.md content for touched areas
    area_docs: dict[str, str] = {}
    for area in areas:
        p = root / area / "CLAUDE.md"
        content = read_truncated(p, 1500)
        if content:
            area_docs[area] = content

    root_claude = read_truncated(root / "CLAUDE.md", 2000)
    agents_md = read_truncated(root / "AGENTS.md", 1000)

    area_docs_text = json.dumps(
        {k: v for k, v in area_docs.items()}, indent=2, ensure_ascii=False
    )

    prompt = f"""You are reviewing whether the project's CLAUDE.md conventions are still \
accurate after recent code changes.

## Root CLAUDE.md
{root_claude}

## AGENTS.md
{agents_md}

## CLAUDE.md files for changed areas
{area_docs_text}

## Recent diff (changed files)
```
{diff[:4000]}{"\\n...[truncated]" if len(diff) > 4000 else ""}
```

Review the above and identify any conventions, file maps, data-flow descriptions, \
or shared-deps lists in the CLAUDE.md files that may now be stale or incorrect \
given the diff.

Write a brief proposal (under 300 words) of specific updates needed. Format each \
finding as:
- **[area/CLAUDE.md]**: what to update and why

If everything looks accurate, say "No updates needed."
"""

    output_path = root / ".claude" / "claude-md-review.md"
    stamp_file = root / ".claude" / ".last_reflect_hash"

    try:
        client = anthropic.Anthropic()
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        proposal = message.content[0].text
    except Exception as exc:
        proposal = (
            f"Reflection failed ({exc}).\n\n"
            f"Re-check these areas manually: {', '.join(areas)}"
        )

    header = (
        "# CLAUDE.md Review\n\n"
        f"*Triggered after changes to: {', '.join(areas)}*\n\n"
    )
    output_path.write_text(header + proposal + "\n", encoding="utf-8")

    if fingerprint:
        stamp_file.write_text(fingerprint, encoding="utf-8")


if __name__ == "__main__":
    main()
