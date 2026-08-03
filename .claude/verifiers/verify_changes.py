"""Verify the working tree's changed files against the project's invariants.

Two ways in:

  * `uv run .claude/verifiers/verify_changes.py` — human/agent-facing report of
    every finding in the current diff. Exits 1 when a BLOCK-severity finding
    survives, so it also works as a CI or pre-commit gate.
  * as a Stop hook — same scan, but the report is emitted as
    `additionalContext` so Claude sees its own findings before finishing a
    turn, and only when something was actually found.

Complements the two existing quality gates rather than duplicating them:
`.husky/pre-commit` runs tsc + eslint (type and style), `.husky/pre-push` runs
jest + build (behaviour). Neither knows anything about tenant isolation, the
server/client secret boundary, or the Stripe source-of-truth rule — those are
project invariants that only exist in prose. This is where they get enforced.

Flags:
  --all         scan every tracked file, not just the diff (baseline audit)
  --staged      scan the staged set only (use from .husky/pre-commit)
  --hook        emit Claude Code Stop-hook JSON instead of plain text
  --block-only  report BLOCK findings only
  --json        machine-readable output

Run manually:  uv run .claude/verifiers/verify_changes.py --all
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "hooks"))

from rules import BLOCK, WARN, Finding, scan_file  # noqa: E402

from _areas import changed_paths, git_lines, repo_root  # noqa: E402

SCANNABLE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql")


def staged_paths(root: Path) -> list[str]:
    return git_lines("diff", "-z", "--name-only", "--cached", cwd=root)


def all_tracked(root: Path) -> list[str]:
    return git_lines("ls-files", "-z", cwd=root)


def scannable(paths: list[str]) -> list[str]:
    """Keep source files we have rules for, and drop other people's code.

    `.worktrees/` holds full parallel checkouts and `node_modules/` is 750MB of
    third-party source — scanning either produces findings nobody can act on.
    """
    out = []
    for path in paths:
        if path.startswith((".worktrees/", "node_modules/", "graphify-out/")):
            continue
        if path.endswith(SCANNABLE_SUFFIXES):
            out.append(path)
    return out


def collect(root: Path, paths: list[str], severities: tuple[str, ...]) -> list[Finding]:
    findings: list[Finding] = []
    for path in scannable(paths):
        findings.extend(scan_file(root, path, severities))
    # BLOCK first, then grouped by file so the report reads top-down by urgency.
    return sorted(findings, key=lambda f: (f.rule.severity != BLOCK, f.path, f.line_no))


def render(findings: list[Finding]) -> str:
    blocks = [f for f in findings if f.rule.severity == BLOCK]
    warns = [f for f in findings if f.rule.severity == WARN]

    lines: list[str] = []
    if blocks:
        lines.append(f"BLOCKING ({len(blocks)}) — these violate a documented invariant:")
        lines += [f"  {f.format()}" for f in blocks]
        lines.append("")
    if warns:
        lines.append(f"WARNINGS ({len(warns)}) — review before committing:")
        lines += [f"  {f.format()}" for f in warns]
        lines.append("")
    lines.append(
        "Suppress a judged exception with `// verifier:allow <rule-id>` on the line. "
        "Rules live in .claude/verifiers/rules.py."
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="scan every tracked file")
    parser.add_argument("--staged", action="store_true", help="scan the staged set only")
    parser.add_argument("--hook", action="store_true", help="emit Stop-hook JSON")
    parser.add_argument("--block-only", action="store_true", help="BLOCK findings only")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    # A Stop hook is handed session JSON on stdin; read and discard it so the
    # writing end never blocks on a full pipe.
    if args.hook and not sys.stdin.isatty():
        try:
            json.load(sys.stdin)
        except Exception:
            pass

    root = repo_root()
    if root is None:
        sys.exit(0)

    if args.all:
        paths = all_tracked(root)
    elif args.staged:
        paths = staged_paths(root)
    else:
        paths = changed_paths(root)

    severities = (BLOCK,) if args.block_only else (BLOCK, WARN)
    findings = collect(root, paths, severities)

    if args.as_json:
        print(json.dumps([
            {
                "rule": f.rule.id,
                "severity": f.rule.severity,
                "path": f.path,
                "line": f.line_no,
                "message": f.rule.message,
                "tags": list(f.rule.tags),
            }
            for f in findings
        ], indent=2))
    elif args.hook:
        # Silence is the common case; only speak up when there is something to fix.
        if findings:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "Stop",
                    "additionalContext": (
                        "Project verifier found issues in the code you just "
                        "changed. Fix the BLOCKING ones before finishing; judge "
                        f"the warnings.\n\n{render(findings)}"
                    ),
                }
            }))
        sys.exit(0)
    elif findings:
        print(render(findings))
    else:
        print(f"Verifier: clean ({len(scannable(paths))} files scanned).")

    sys.exit(1 if any(f.rule.severity == BLOCK for f in findings) else 0)


if __name__ == "__main__":
    main()
