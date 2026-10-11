#!/usr/bin/env python3
"""PreToolUse gate: no `gh pr create` until the branch has been reviewed.

Hook mode (stdin = PreToolUse JSON): if the Bash command opens a PR and the
commit it would open from has no review marker, deny it and tell Claude to run
/code-review and the pr-reviewer agent first.

Mark mode (`--mark [<ref>]`): record that HEAD (or <ref>) of the current
directory's repo has been reviewed. Run after both reviews are done and their
blockers are fixed. A new commit changes the SHA, so any fix made after the
review needs a fresh review before the PR opens.

Markers live in `<git-common-dir>/claude-pr-review/<sha>` — outside the work
tree (never committed) and shared across worktrees.

This is a guardrail against *accidentally* skipping review, not a security
boundary: it fails open (with a visible warning) if it cannot work out the
target, and deliberate evasion (`bash -c '…'`, `gh api …/pulls`) is out of
scope. Tests: `python3 .claude/hooks/test_pr_review_gate.py`.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT = Path(__file__).resolve()

# A heredoc opener (`<<EOF`, `<<-'EOF'`, `<< "EOF"`) but not a here-string `<<<`.
HEREDOC = re.compile(r"(?<!<)<<(?!<)-?\s*(['\"]?)([A-Za-z_]\w*)\1")

# Where a new simple command can start: start of input, a shell separator or
# newline, a command substitution or backtick, or a compound-command keyword.
SEP = r"(?:\A|[;&|(\n`]|\$\(|\b(?:then|do|else|elif)\b)"
# Prefixes that still run the next word as a command.
PREFIX = r"(?:(?:\w+=\S*|command|env|time|exec|nohup|sudo)\s+)*"
# `gh` or a path ending in `/gh`, then any global flags (`-R owner/repo`).
GH = r"(?:\S*/)?gh(?:\s+-\S+(?:\s+(?!pr\b)[^\s\-;&|]\S*)?)*"
PR_CREATE = re.compile(
    SEP + r"\s*" + PREFIX + GH + r"\s+pr\s+(?:create|new)(?![\w-])"
)
# These stop right after the keyword: the argument may be a quoted string,
# which is blank in the matched text, so it is read back from the original.
CD = re.compile(r"(?:\A|[;&|(\n])\s*cd(?=\s)")
SEGMENT_END = re.compile(r"[;&|\n)`]")
HEAD_FLAG = re.compile(r"\s(?:--head|-H)(?=[=\s])")


@dataclass
class Target:
    cd: str | None  # directory from a preceding `cd`, as written
    head: str | None  # branch from `--head`/`-H`, as written


def blank_inert(cmd: str) -> str:
    """Blank text the shell won't execute, keeping the string's length.

    Heredoc bodies and quoted strings become spaces (newlines kept), except
    `$(…)` and backtick substitutions inside double quotes, which do run.
    Positions in the result line up with positions in `cmd`.
    """
    out = list(cmd)

    def blank(start: int, end: int) -> None:
        for i in range(start, end):
            if out[i] != "\n":
                out[i] = " "

    # Heredoc bodies: from the line after the opener through the terminator.
    pos = 0
    while m := HEREDOC.search(cmd, pos):
        body = cmd.find("\n", m.end())
        if body == -1:
            break
        term = re.compile(r"^\t*" + re.escape(m.group(2)) + r"[ \t]*$", re.M)
        t = term.search(cmd, body + 1)
        end = t.end() if t else len(cmd)
        blank(body + 1, end)
        pos = end

    text = "".join(out)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
        elif c == "'":
            j = text.find("'", i + 1)
            j = n if j == -1 else j
            blank(i, j + 1)
            i = j + 1
        elif c == '"':
            i = _blank_double(text, i, blank)
        else:
            i += 1
    return "".join(out)


def _blank_double(text: str, start: int, blank) -> int:
    """Blank a double-quoted string, keeping `$(…)`/backtick bodies."""
    i, n = start + 1, len(text)
    depth = 0  # nesting inside `$(…)`; > 0 means "executable, keep"
    run_start = start  # start of the current blankable run
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if depth == 0 and c == '"':
            blank(run_start, i + 1)
            return i + 1
        if text.startswith("$(", i):
            if depth == 0:
                blank(run_start, i)
            depth += 1
            i += 2
            continue
        if c == ")" and depth:
            depth -= 1
            i += 1
            if depth == 0:
                run_start = i
            continue
        if c == "`" and depth == 0:
            blank(run_start, i)
            close = text.find("`", i + 1)
            i = n if close == -1 else close + 1
            run_start = i
            continue
        i += 1
    if depth == 0:  # unterminated string: blank to the end
        blank(run_start, n)
    return n


def _word_at(cmd: str, pos: int) -> str | None:
    """The shell word starting at `pos` (after optional `=`/whitespace)."""
    rest = cmd[pos:].split("\n", 1)[0].lstrip(" \t=")
    lexer = shlex.shlex(rest, posix=True, punctuation_chars=";&|()")
    lexer.whitespace_split = True
    try:
        word = lexer.get_token()
    except ValueError:  # unbalanced quote
        return None
    return word if word and word not in ";&|()" else None


def find_target(cmd: str) -> Target | None:
    """Return where the PR would be opened from, or None if no PR is opened."""
    blanked = blank_inert(cmd)
    m = PR_CREATE.search(blanked)
    if not m:
        return None
    cd = None
    for c in CD.finditer(blanked, 0, m.start() + 1):
        cd = _word_at(cmd, c.end())
    end = SEGMENT_END.search(blanked, m.end())
    segment_end = end.start() if end else len(blanked)
    head = None
    if h := HEAD_FLAG.search(blanked, m.end(), segment_end):
        head = _word_at(cmd, h.end())
    return Target(cd=cd, head=head)


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def resolve(cwd: Path, ref: str) -> str:
    """SHA for `ref`, falling back to its remote-tracking branch."""
    try:
        return git(cwd, "rev-parse", "--verify", f"{ref}^{{commit}}")
    except subprocess.CalledProcessError:
        return git(cwd, "rev-parse", "--verify", f"origin/{ref}^{{commit}}")


def marker(cwd: Path, sha: str) -> Path:
    common = Path(git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return common / "claude-pr-review" / sha


def mark(ref: str) -> None:
    cwd = Path.cwd()
    sha = resolve(cwd, ref)
    path = marker(cwd, sha)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    print(f"Marked {ref} ({sha[:12]}) as reviewed.")


def emit(payload: dict) -> None:
    print(json.dumps(payload))


def deny(cwd: Path, ref: str, sha: str) -> None:
    mark_cmd = f"cd {shlex.quote(str(cwd))} && python3 {shlex.quote(str(SCRIPT))} --mark"
    if ref != "HEAD":
        mark_cmd += f" {shlex.quote(ref)}"
    reason = (
        f"PR review gate: {ref} ({sha[:12]}) in {cwd} has not been reviewed. "
        "Before opening the PR:\n"
        "1. Run the /code-review skill on this branch (Skill tool, skill: "
        '"code-review").\n'
        "2. Run the pr-reviewer agent on this branch (Agent tool, subagent_type: "
        '"pr-reviewer"; if that type is unavailable because this session started '
        "before the agent existed, use a general-purpose agent told to follow "
        ".claude/agents/pr-reviewer.md).\n"
        "3. Show the user both reports. Fix any blockers they agree with and "
        "commit (a new commit needs a fresh review).\n"
        f"4. Once the commit is reviewed and clean, run `{mark_cmd}`, then retry "
        "the PR command.\n"
        "Do not run --mark without completing steps 1-3."
    )
    emit(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
    )


def gate(payload: object) -> None:
    if not isinstance(payload, dict):
        return
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return
    target = find_target(str(tool_input.get("command") or ""))
    if target is None:
        return
    base = Path(str(payload.get("cwd") or os.getcwd()))
    cwd = base
    if target.cd:
        cwd = (base / os.path.expanduser(target.cd)).resolve()
    # `--head owner:branch` names a fork branch; the local name is after `:`.
    ref = target.head.rsplit(":", 1)[-1] if target.head else "HEAD"
    sha = resolve(cwd, ref)
    if not marker(cwd, sha).exists():
        deny(cwd, ref, sha)


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--mark":
        mark(args[1] if len(args) > 1 else "HEAD")
        return
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return
    try:
        gate(payload)
    except Exception as exc:  # noqa: BLE001 — fail open, but say so
        emit(
            {
                "systemMessage": (
                    f"PR review gate could not check this command and let it "
                    f"through: {type(exc).__name__}: {exc}"
                )
            }
        )


if __name__ == "__main__":
    main()
