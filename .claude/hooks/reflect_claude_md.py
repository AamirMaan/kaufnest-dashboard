# /// script
# dependencies = ["anthropic"]
# ///
"""Background reflector: judge whether recent changes staled a CLAUDE.md/SKILL.md.

Spawned by propose_claude_md.py, never invoked directly by Claude Code itself.
Bundles the working-tree diff, the list of added-but-untracked files, and both
docs (CLAUDE.md + SKILL.md) of every touched area into a prompt for Claude
Haiku, then writes the verdict to .claude/claude-md-review.md — which
session_start_context.py surfaces at the start of the next session.

Needs an API key in CLAUDE_MD_REFLECT_API_KEY — set it in the gitignored
`.claude/settings.local.json` under "env". The dedicated name is deliberate; see
verdict_for(). Without a key the hook still runs and writes a "check these areas
manually" note, it just skips the LLM call.

Manual run:
  CLAUDE_MD_REFLECT_LOCK=1 CLAUDE_MD_REFLECT_AREAS='["src/app/dashboard/sales"]' \\
      uv run .claude/hooks/reflect_claude_md.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import anthropic  # noqa: E402

from _areas import DOC_FILENAMES, repo_root  # noqa: E402

MODEL = "claude-haiku-4-5-20251001"
API_KEY_VAR = "CLAUDE_MD_REFLECT_API_KEY"
MAX_TOKENS = 700
DIFF_CHAR_LIMIT = 4000
AREA_DOC_CHAR_LIMIT = 1500
ROOT_DOC_CHAR_LIMIT = 2000
AGENTS_MD_CHAR_LIMIT = 1000
REVIEW_FILE = ".claude/claude-md-review.md"
FINGERPRINT_FILE = ".claude/.claude_md_review_fingerprint"


def truncated(path: Path, limit: int) -> str:
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[truncated]"


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "\n...[truncated]"


def build_prompt(root: Path, areas: list[str], diff: str, new_files: list[str]) -> str:
    # Both docs per area: CLAUDE.md carries the file map, SKILL.md the agent
    # playbook and gotchas. AGENTS.md requires both to be updated together, so
    # reviewing only one would miss half the drift.
    area_docs: dict[str, str] = {}
    for area in areas:
        for name in DOC_FILENAMES:
            content = truncated(root / area / name, AREA_DOC_CHAR_LIMIT)
            if content:
                area_docs[f"{area}/{name}"] = content

    new_files_text = "\n".join(f"- {f}" for f in new_files) or "(none)"

    return f"""You are checking whether this project's CLAUDE.md and SKILL.md files \
still describe the code accurately after a recent change.

## Root CLAUDE.md
{truncated(root / "CLAUDE.md", ROOT_DOC_CHAR_LIMIT)}

## AGENTS.md
{truncated(root / "AGENTS.md", AGENTS_MD_CHAR_LIMIT)}

## Docs of each changed area
{json.dumps(area_docs, indent=2, ensure_ascii=False)}

## New files not yet in any diff
{new_files_text}

## Diff being reviewed
```
{clip(diff, DIFF_CHAR_LIMIT)}
```

Report only concrete staleness you can point at in the docs above — a file map \
missing a new file or naming a deleted one, a data-flow description the diff \
contradicts, a shared-dependency list that is now wrong, or a new non-obvious \
constraint that belongs in SKILL.md's gotchas. Ignore wording and style.

Reply in under 300 words, one bullet per finding:
- **[path/to/DOC.md]**: what's stale and what it should say instead

If nothing is stale, reply exactly: No updates needed.
"""


def verdict_for(prompt: str, areas: list[str]) -> str:
    # Prefer a dedicated variable over ANTHROPIC_API_KEY: Claude Code reads that
    # name for its own auth, so exporting it session-wide would silently move the
    # main session off subscription billing and onto API credits. This reviewer
    # is the only thing that should be spending here.
    api_key = os.environ.get(API_KEY_VAR) or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return (
            f"No {API_KEY_VAR} (or ANTHROPIC_API_KEY) in the hook environment, so "
            "no automated review ran.\n\nRe-check the docs of these areas "
            f"manually: {', '.join(areas)}"
        )
    try:
        response = anthropic.Anthropic(api_key=api_key).messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        ).strip()
        return text or "No updates needed."
    except Exception as exc:
        return (
            f"Reflection failed ({exc}).\n\n"
            f"Re-check the docs of these areas manually: {', '.join(areas)}"
        )


def main() -> None:
    if not os.environ.get("CLAUDE_MD_REFLECT_LOCK"):
        sys.exit(0)  # never self-invoke outside propose_claude_md.py

    areas = json.loads(os.environ.get("CLAUDE_MD_REFLECT_AREAS", "[]"))
    fingerprint = os.environ.get("CLAUDE_MD_REFLECT_FINGERPRINT", "")
    changed = json.loads(os.environ.get("CLAUDE_MD_REFLECT_CHANGED", "[]"))

    root = repo_root()
    if root is None:
        sys.exit(0)

    diff = subprocess.run(
        ["git", "diff", "HEAD"], capture_output=True, text=True, cwd=root
    ).stdout
    tracked = set(
        subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True,
            text=True,
            cwd=root,
        ).stdout.split()
    )
    new_files = [f for f in changed if f not in tracked]

    verdict = verdict_for(build_prompt(root, areas, diff, new_files), areas)

    (root / REVIEW_FILE).write_text(
        "# Doc Drift Review\n\n"
        f"*Triggered after changes to: {', '.join(areas)}*\n\n"
        f"{verdict}\n",
        encoding="utf-8",
    )

    if fingerprint:
        (root / FINGERPRINT_FILE).write_text(fingerprint, encoding="utf-8")


if __name__ == "__main__":
    main()
