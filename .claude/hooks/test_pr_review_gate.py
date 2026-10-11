"""Tests for the pre-PR review gate (`pr_review_gate.py`).

Not part of the Jest suite (jest.config.ts only discovers `src/**/*.test.ts(x)`).
Run directly:

    python3 .claude/hooks/test_pr_review_gate.py

Every matching rule needs a negative case next to its positive one: a gate that
fires on commit messages and heredocs teaches Claude to `--mark` just to get an
unrelated command through, which defeats the gate.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pr_review_gate import Target, find_target  # noqa: E402

GATE = Path(__file__).parent / "pr_review_gate.py"

# (name, command, expected Target or None)
CASES: list[tuple[str, str, Target | None]] = [
    # ---- opens a PR ----
    ("plain", "gh pr create --title t", Target(None, None)),
    ("after push", "git push -u origin x && gh pr create --fill", Target(None, None)),
    ("env prefix", "GH_TOKEN=x gh pr create", Target(None, None)),
    ("quoted env value", 'GH_TOKEN="a b" gh pr create', Target(None, None)),
    ("env command", "env GH_TOKEN=x gh pr create", Target(None, None)),
    ("command builtin", "command gh pr create", Target(None, None)),
    ("time", "time gh pr create", Target(None, None)),
    ("absolute path", "/opt/homebrew/bin/gh pr create", Target(None, None)),
    ("global flag", "gh -R owner/repo pr create", Target(None, None)),
    ("long global flag", "gh --repo owner/repo pr create", Target(None, None)),
    ("pr new alias", "gh pr new --fill", Target(None, None)),
    ("then", "if git push; then gh pr create; fi", Target(None, None)),
    ("subshell", "(gh pr create)", Target(None, None)),
    ("substitution", 'URL=$(gh pr create --fill)', Target(None, None)),
    ("backticks", "URL=`gh pr create --fill`", Target(None, None)),
    ("substitution in quotes", 'echo "$(gh pr create --fill)"', Target(None, None)),
    ("next line", "git push\ngh pr create --fill", Target(None, None)),
    ("body heredoc", "gh pr create --body \"$(cat <<'EOF'\nhi\nEOF\n)\"",
     Target(None, None)),
    ("cd first", "cd ../wt && gh pr create", Target("../wt", None)),
    ("quoted cd", "cd '/tmp/my wt' && gh pr create", Target("/tmp/my wt", None)),
    ("last cd wins", "cd a && cd b; gh pr create", Target("b", None)),
    ("head flag", "gh pr create --head feat/x --fill", Target(None, "feat/x")),
    ("head equals", "gh pr create --head=feat/x", Target(None, "feat/x")),
    ("short head", "gh pr create -H owner:feat/x", Target(None, "owner:feat/x")),
    # ---- does not open a PR ----
    ("unrelated", "ls -la", None),
    ("other subcommand", "gh pr view 124", None),
    ("echo double", 'echo "gh pr create --title t"', None),
    ("echo single", "echo 'gh pr create'", None),
    ("commit mention", "git commit -m 'gate blocks gh pr create'", None),
    ("separator in quotes", 'git commit -m "docs; gh pr create is gated"', None),
    ("pipe in quotes", "git commit -m 'x | gh pr create'", None),
    ("commit heredoc", 'git commit -m "$(cat <<\'E\'\nfix\n\ngh pr create now gated\nE\n)"',
     None),
    ("cat heredoc", "cat <<E\ngh pr create\nE", None),
    ("heredoc paren", "cat > t.py <<'EOF'\ncases = {\"(gh pr create)\": 1}\nEOF", None),
    ("python string", 'python3 -c "print(\'cd wt && gh pr create\')"', None),
    ("grep for it", "grep -rn 'gh pr create' .claude", None),
    ("longer subcommand", "gh pr create-foo", None),
    ("head of other cmd", "gh pr view --head x && git log", None),
]


def run_gate(payload: object) -> dict | None:
    out = subprocess.run(
        ["python3", str(GATE)], input=json.dumps(payload),
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return json.loads(out) if out else None


def decision(result: dict | None) -> str:
    if result is None:
        return "allow"
    if "hookSpecificOutput" in result:
        return result["hookSpecificOutput"]["permissionDecision"]
    return "warn"


def make_repo(root: Path, name: str) -> Path:
    repo = root / name
    repo.mkdir()
    git = ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t"]
    subprocess.run([*git, "init", "-q", "-b", "main"], check=True)
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "a"], check=True)
    subprocess.run([*git, "branch", "feat"], check=True)
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "b"], check=True)
    return repo


def mark(repo: Path, *ref: str) -> None:
    subprocess.run(["python3", str(GATE), "--mark", *ref], cwd=repo,
                   capture_output=True, check=True)


def end_to_end() -> list[str]:
    failures = []

    def expect(name: str, payload: object, want: str) -> None:
        got = decision(run_gate(payload))
        if got != want:
            failures.append(f"{name}: expected {want}, got {got}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        a, b = make_repo(root, "a"), make_repo(root, "b")
        cmd = {"command": "gh pr create --fill"}

        expect("unreviewed HEAD", {"cwd": str(a), "tool_input": cmd}, "deny")
        mark(a)
        expect("reviewed HEAD", {"cwd": str(a), "tool_input": cmd}, "allow")
        expect("cd into unreviewed repo",
               {"cwd": str(a), "tool_input": {"command": "cd ../b && gh pr create"}},
               "deny")
        expect("--head unreviewed branch",
               {"cwd": str(a), "tool_input": {"command": "gh pr create --head feat"}},
               "deny")
        mark(a, "feat")
        expect("--head reviewed branch",
               {"cwd": str(a), "tool_input": {"command": "gh pr create --head feat"}},
               "allow")
        expect("not a git repo warns",
               {"cwd": str(root), "tool_input": cmd}, "warn")
        expect("unrelated command", {"cwd": str(b), "tool_input": {"command": "ls"}},
               "allow")

    for name, payload in [
        ("null command", {"tool_input": {"command": None}}),
        ("null tool_input", {"tool_input": None}),
        ("list payload", [1, 2]),
    ]:
        expect(name, payload, "allow")
    return failures


def main() -> None:
    failures = []
    for name, cmd, want in CASES:
        got = find_target(cmd)
        if got != want:
            failures.append(f"{name}: {cmd!r}\n    expected {want}, got {got}")
    failures += end_to_end()
    total = len(CASES) + 10
    for f in failures:
        print(f"FAIL {f}")
    print(f"{total - len(failures)}/{total} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
