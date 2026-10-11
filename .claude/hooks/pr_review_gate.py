#!/usr/bin/env python3
"""PreToolUse gate: no `gh pr create` until the branch has been reviewed.

Hook mode (stdin = PreToolUse JSON): if the Bash command opens a PR and the
current HEAD has no review marker, deny it and tell Claude to run /code-review
and the pr-reviewer agent first.

Mark mode (`--mark`): record that HEAD has been reviewed. Run after both
reviews are done and their blockers are fixed. A new commit changes HEAD, so
any fix made after the review needs a fresh review before the PR opens.

Markers live in `<git-common-dir>/claude-pr-review/<sha>` — outside the work
tree (never committed) and shared across worktrees.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

# `gh` in command position only — start of a line or after a shell separator,
# optionally behind VAR=value prefixes — so a commit message or heredoc that
# merely mentions the command doesn't trip the gate.
PR_CREATE = re.compile(
    r"(?:^|[;&|(]|\$\()\s*(?:\w+=\S*\s+)*gh\s+pr\s+create\b", re.MULTILINE
)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def marker_path() -> Path:
    common = Path(git("rev-parse", "--git-common-dir")).resolve()
    return common / "claude-pr-review" / git("rev-parse", "HEAD")


def mark() -> None:
    path = marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    print(f"Marked {path.name[:12]} as reviewed.")


def deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def gate() -> None:
    try:
        payload = json.load(sys.stdin)
        command = payload.get("tool_input", {}).get("command", "")
    except (json.JSONDecodeError, AttributeError):
        return
    if not PR_CREATE.search(command):
        return
    try:
        path = marker_path()
    except subprocess.CalledProcessError:
        return  # not in a git repo — nothing to gate
    if path.exists():
        return
    sha = path.name[:12]
    deny(
        f"PR review gate: HEAD {sha} has not been reviewed. Before opening the PR:\n"
        "1. Run the /code-review skill on this branch (Skill tool, skill: "
        "\"code-review\").\n"
        "2. Run the pr-reviewer agent on this branch (Agent tool, "
        "subagent_type: \"pr-reviewer\").\n"
        "3. Show the user both reports. Fix any blockers they agree with and "
        "commit (a new commit needs a fresh review).\n"
        "4. Once HEAD is reviewed and clean, run "
        "`python3 .claude/hooks/pr_review_gate.py --mark`, then retry "
        "`gh pr create`.\n"
        "Do not run --mark without completing steps 1-3."
    )


if __name__ == "__main__":
    mark() if "--mark" in sys.argv[1:] else gate()
