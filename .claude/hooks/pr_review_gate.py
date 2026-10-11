#!/usr/bin/env python3
"""PreToolUse gate: no `gh pr create` until the branch has been reviewed.

Hook mode (stdin = PreToolUse JSON). When a Bash command opens a PR:
  - if it also contains a `cd`/`pushd` or `--head`/`-H`, deny it outright —
    the gate does not guess which commit such a command targets; Claude is told
    to run a plain `gh pr create` as its own call from the branch's checkout
    (the working directory persists between Bash calls, so the hook's `cwd`
    is then exactly where the PR is opened from);
  - otherwise, if HEAD of the hook's `cwd` has no review marker, deny it and
    tell Claude to run /code-review and the pr-reviewer agent first.

Mark mode (`--mark`): record that HEAD of the current directory's repo has
been reviewed. A new commit changes the SHA, so any fix made after the review
needs a fresh review before the PR opens.

Markers live in `<git-common-dir>/claude-pr-review/<sha>` — outside the work
tree (never committed) and shared across worktrees.

This is a guardrail against *accidentally* skipping review, not a security
boundary: it fails open (with a visible warning) on errors, and deliberate
evasion (`bash -c '…'`, `gh api …/pulls`) is out of scope. Runs on the macOS
system Python (3.9). Tests: `python3 .claude/hooks/test_pr_review_gate.py`.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve()

# Where a simple command can start: start of input, a separator or newline, a
# substitution, optionally followed by compound-command keywords (`if !`, `{`).
START = (
    r"(?:\A|[;&|(\n`]|\$\()\s*"
    r"(?:(?:then|do|else|elif|if|while|until|!|\{)\s+)*"
)
# Prefixes that still run the next word as a command, with their own flags.
PREFIX = (
    r"(?:(?:\w+=\S*"
    r"|(?:command|env|time|exec|nohup|sudo)(?:\s+-\S+(?:\s+(?!gh\b|-)\S+)?)*"
    r")\s+)*"
)
# `gh` or a path ending in `/gh`, then any global flags (`-R owner/repo`).
GH = r"(?:\S*/)?gh(?:\s+-\S+(?:\s+(?!pr\b)[^\s\-;&|]\S*)?)*"
PR_CREATE = re.compile(START + PREFIX + GH + r"\s+pr\s+(?:create|new)(?![\w-])")
# Anything that makes the target commit something other than HEAD of `cwd`.
CHANGES_DIR = re.compile(r"(?:\A|[;&|(\n`{]|\$\()\s*(?:cd|pushd)(?![\w-])")
# `--head x`, `--head=x`, `-H x`, `-Hx`. Over-matching (e.g. `curl -H`) only
# matters when the same command also opens a PR, and then splitting is fine.
HEAD_FLAG = re.compile(r"\s(?:--head(?=[=\s]|\Z)|-H)")

WORD_END = set(" \t\n;&|<>()")


def blank_inert(cmd: str) -> str:
    """Blank text the shell won't execute as commands, keeping the length.

    Quoted strings, `#` comments, heredoc bodies and `$((…))` arithmetic become
    spaces; `$(…)`/backticks — even inside double quotes — stay, because they
    run. A backslash-newline continuation becomes spaces too, joining its
    lines. Every position in the result lines up with the same one in `cmd`.
    """
    n = len(cmd)
    out = list(cmd)

    def blank(a: int, b: int, keep_newlines: bool = True) -> None:
        for k in range(a, min(b, n)):
            if not (keep_newlines and out[k] == "\n"):
                out[k] = " "

    stack = ["cmd"]  # "cmd" | "subst" ($(…)) | "tick" (`…`) | "dq" ("…")
    heredocs: list[tuple[str, bool]] = []  # (delimiter, strip_tabs) awaiting a newline
    i = 0
    while i < n:
        ctx, c = stack[-1], cmd[i]

        if ctx == "dq":
            if c == "\\":
                blank(i, i + 2)
                i += 2
            elif c == '"':
                blank(i, i + 1)
                stack.pop()
                i += 1
            elif cmd.startswith("$((", i):
                i = _skip_arith(cmd, i, blank)
            elif cmd.startswith("$(", i):
                stack.append("subst")
                i += 2
            elif c == "`":
                stack.append("tick")
                i += 1
            else:
                blank(i, i + 1)
                i += 1
            continue

        # Command context: top level, inside $(…), or inside backticks.
        if c == "\\":
            blank(i, i + 2, keep_newlines=False)  # also joins `\`+newline
            i += 2
        elif c == "'":
            close = cmd.find("'", i + 1)
            end = n if close == -1 else close + 1
            blank(i, end)
            i = end
        elif c == '"':
            blank(i, i + 1)
            stack.append("dq")
            i += 1
        elif cmd.startswith("$((", i):
            i = _skip_arith(cmd, i, blank)
        elif cmd.startswith("$(", i):
            stack.append("subst")
            i += 2
        elif c == "`":
            if ctx == "tick":
                stack.pop()
            else:
                stack.append("tick")
            i += 1
        elif c == ")" and ctx == "subst":
            stack.pop()
            i += 1
        elif c == "#" and (i == 0 or cmd[i - 1] in WORD_END):
            eol = cmd.find("\n", i)
            eol = n if eol == -1 else eol
            blank(i, eol)
            i = eol
        elif opener := _heredoc_opener(cmd, i):
            delimiter, strip_tabs, i = opener
            heredocs.append((delimiter, strip_tabs))
        elif c == "\n" and heredocs:
            i = _blank_heredoc_bodies(cmd, i + 1, heredocs, blank)
            heredocs.clear()
        else:
            i += 1
    return "".join(out)


def _skip_arith(cmd: str, i: int, blank) -> int:
    """Blank a `$((…))` arithmetic expansion (its `<<` is a shift)."""
    depth, j = 0, i + 1
    while j < len(cmd):
        if cmd[j] == "(":
            depth += 1
        elif cmd[j] == ")":
            depth -= 1
            if depth == 0:
                break
        j += 1
    blank(i, j + 1)
    return j + 1


def _heredoc_opener(cmd: str, i: int) -> tuple[str, bool, int] | None:
    """Parse `<<WORD`, `<<-WORD`, `<< 'WORD'`, `<<\\WORD` at `i` (not `<<<`)."""
    if not cmd.startswith("<<", i) or cmd.startswith("<<<", i):
        return None
    if i and cmd[i - 1] == "<":
        return None
    j = i + 2
    strip_tabs = j < len(cmd) and cmd[j] == "-"
    j += strip_tabs
    while j < len(cmd) and cmd[j] in " \t":
        j += 1
    delimiter = []
    while j < len(cmd) and cmd[j] not in WORD_END:
        ch = cmd[j]
        if ch in "'\"":
            close = cmd.find(ch, j + 1)
            close = len(cmd) if close == -1 else close
            delimiter.append(cmd[j + 1:close])
            j = close + 1
        elif ch == "\\":
            delimiter.append(cmd[j + 1:j + 2])
            j += 2
        else:
            delimiter.append(ch)
            j += 1
    word = "".join(delimiter)
    return (word, strip_tabs, j) if word else None


def _blank_heredoc_bodies(cmd: str, pos: int, heredocs, blank) -> int:
    """Blank each pending heredoc body in turn, starting at `pos`."""
    n = len(cmd)
    for delimiter, strip_tabs in heredocs:
        start = pos
        while pos < n:
            eol = cmd.find("\n", pos)
            eol = n if eol == -1 else eol
            line = cmd[pos:eol]
            if (line.lstrip("\t") if strip_tabs else line) == delimiter:
                blank(start, eol)
                pos = eol + 1
                break
            pos = eol + 1
        else:
            blank(start, n)
    return min(pos, n)


def classify(cmd: str) -> str | None:
    """None if no PR is opened, "ambiguous" if the target can't be HEAD of
    `cwd`, else "plain"."""
    blanked = blank_inert(cmd)
    if not PR_CREATE.search(blanked):
        return None
    if CHANGES_DIR.search(blanked) or HEAD_FLAG.search(blanked):
        return "ambiguous"
    return "plain"


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def marker(cwd: Path) -> tuple[Path, str]:
    sha = git(cwd, "rev-parse", "HEAD")
    common = Path(git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return common / "claude-pr-review" / sha, sha


def mark() -> None:
    path, sha = marker(Path.cwd())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    print(f"Marked HEAD ({sha[:12]}) as reviewed.")


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


AMBIGUOUS = (
    "PR review gate: this command opens a PR and also changes directory "
    "(`cd`/`pushd`) or names a branch (`--head`/`-H`), so the gate can't tell "
    "which commit the PR would be opened from. If you need another checkout, "
    "`cd` there in its own Bash call (the working directory persists), make sure "
    "the branch is pushed, then run `gh pr create` as its own call without "
    "`--head`."
)


def unreviewed(cwd: Path, sha: str) -> str:
    mark_cmd = f"python3 {shlex.quote(str(SCRIPT))} --mark"
    return (
        f"PR review gate: HEAD ({sha[:12]}) in {cwd} has not been reviewed. "
        "Before opening the PR:\n"
        "1. Run the /code-review skill on this branch (Skill tool, skill: "
        '"code-review").\n'
        "2. Run the pr-reviewer agent on this branch (Agent tool, subagent_type: "
        '"pr-reviewer"; if that type is unavailable because this session started '
        "before the agent existed, use a general-purpose agent told to follow "
        ".claude/agents/pr-reviewer.md).\n"
        "3. Show the user both reports. Fix any blockers they agree with and "
        "commit (a new commit needs a fresh review).\n"
        f"4. Once HEAD is reviewed and clean, run `{mark_cmd}` from {cwd}, then "
        "retry `gh pr create`.\n"
        "Do not run --mark without completing steps 1-3."
    )


def gate(payload: object) -> None:
    if not isinstance(payload, dict):
        return
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return
    kind = classify(str(tool_input.get("command") or ""))
    if kind is None:
        return
    if kind == "ambiguous":
        deny(AMBIGUOUS)
        return
    cwd = Path(str(payload.get("cwd") or os.getcwd()))
    path, sha = marker(cwd)
    if not path.exists():
        deny(unreviewed(cwd, sha))


def main() -> None:
    if sys.argv[1:] == ["--mark"]:
        mark()
        return
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return
    try:
        gate(payload)
    except Exception as exc:  # noqa: BLE001 — fail open, but say so
        print(
            json.dumps(
                {
                    "systemMessage": (
                        "PR review gate could not check this command and let it "
                        f"through: {type(exc).__name__}: {exc}"
                    )
                }
            )
        )


if __name__ == "__main__":
    main()
