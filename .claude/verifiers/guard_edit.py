"""PreToolUse hook: refuse a Write/Edit that would break a project invariant.

Runs only the BLOCK-severity rules from rules.py, against the content Claude is
*about to* write — so the violation never lands on disk and never has to be
noticed in review. WARN-severity rules are deliberately not enforced here;
they surface in verify_changes.py's report instead, where a human can judge
them without a tool call being denied mid-task.

Contract with Claude Code:
  stdin  — the PreToolUse event JSON (tool_name, tool_input)
  stdout — `permissionDecision: "deny"` + reason, or nothing at all
  exit 0 — always, even on internal error. A crashing guard must never wedge
           the session; the reporter still catches anything missed here.

Supported tools: Write (`content`), Edit (`new_string`), MultiEdit (`edits[]`).
For Edit the guard sees only the replacement text, not the merged file, so
file-level rules (the "use client" pair-checks) are evaluated against the
on-disk file with the replacement spliced in — see merged_content().

Escape hatch: add `// verifier:allow <rule-id>` to the offending line.

Run manually:
  echo '{"tool_name":"Write","tool_input":{"file_path":"src/x.ts","content":"…"}}' \\
      | uv run .claude/verifiers/guard_edit.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "hooks"))

from rules import BLOCK, scan_text  # noqa: E402

try:
    from _areas import repo_root  # noqa: E402
except ImportError:  # hooks/ moved or missing — fall back to plain git discovery
    import subprocess

    def repo_root() -> Path | None:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
        )
        return Path(out.stdout.strip()) if out.returncode == 0 else None


def proposed_content(tool_name: str, tool_input: dict) -> str:
    """The text this tool call wants to introduce."""
    if tool_name == "Write":
        return str(tool_input.get("content") or "")
    if tool_name == "Edit":
        return str(tool_input.get("new_string") or "")
    if tool_name == "MultiEdit":
        return "\n".join(
            str(e.get("new_string") or "") for e in tool_input.get("edits") or []
        )
    return ""


def merged_content(root: Path, rel_path: str, tool_name: str, new_text: str) -> str:
    """New text plus enough of the existing file for file-level rules to work.

    A rule like `server-module-in-client` only fires when the file *also*
    contains a "use client" directive. On an Edit that directive usually sits
    outside the replaced hunk, so scanning `new_string` alone would miss every
    real case. Concatenating the current file is enough for the presence check
    while line numbers still come from the new text.
    """
    if tool_name == "Write":
        return new_text
    existing = ""
    target = root / rel_path
    if target.is_file():
        try:
            existing = target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            existing = ""
    return new_text + "\n" + existing


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = event.get("tool_name", "")
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        sys.exit(0)

    tool_input = event.get("tool_input") or {}
    file_path = str(tool_input.get("file_path") or "")
    if not file_path:
        sys.exit(0)

    root = repo_root()
    if root is None:
        sys.exit(0)

    try:
        rel_path = str(Path(file_path).resolve().relative_to(root.resolve()))
    except ValueError:
        sys.exit(0)  # outside the repo (scratchpad, ~/.claude) — not ours to police

    new_text = proposed_content(tool_name, tool_input)
    if not new_text.strip():
        sys.exit(0)

    # Line-level findings come from the new text only, so reported line numbers
    # aren't offset by the appended existing file.
    findings = scan_text(rel_path, new_text, severities=(BLOCK,))
    seen = {(f.rule.id, f.line_no) for f in findings}
    for finding in scan_text(rel_path, merged_content(root, rel_path, tool_name, new_text),
                             severities=(BLOCK,)):
        if (finding.rule.id, finding.line_no) not in seen:
            findings.append(finding)

    if not findings:
        sys.exit(0)

    blocks = "\n\n".join(
        f"• [{f.rule.id}] {f.rule.message}\n  Why: {f.rule.why}\n  At: {f.path}:{f.line_no}"
        for f in findings
    )
    deny(
        "Blocked by KaufNest project verifier — this edit violates an "
        f"invariant documented in AGENTS.md:\n\n{blocks}\n\n"
        "Fix the code and retry. If this is a judged exception, add "
        "`// verifier:allow <rule-id>` on that line."
    )


if __name__ == "__main__":
    main()
