"""Tests for the pre-PR review gate (`pr_review_gate.py`).

Not part of the Jest suite (jest.config.ts only discovers `src/**/*.test.ts(x)`).
Run directly:

    python3 .claude/hooks/test_pr_review_gate.py

Every matching rule needs a negative case next to its positive one: a gate that
fires on commit messages and heredocs teaches Claude to `--mark` just to get an
unrelated command through, which defeats the gate. Cases marked (r1)/(r2) came
from the first and second review rounds.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pr_review_gate import blank_inert, classify  # noqa: E402

GATE = Path(__file__).parent / "pr_review_gate.py"
PLAIN, AMBIG = "plain", "ambiguous"

# (name, command, expected classify() result)
CASES: list[tuple[str, str, str | None]] = [
    # ---- opens a PR from HEAD of cwd ----
    ("plain", "gh pr create --title t", PLAIN),
    ("after push", "git push -u origin x && gh pr create --fill", PLAIN),
    ("env prefix", "GH_TOKEN=x gh pr create", PLAIN),
    ("quoted env value", 'GH_TOKEN="a b" gh pr create', PLAIN),
    ("env command", "env GH_TOKEN=x gh pr create", PLAIN),
    ("command builtin", "command gh pr create", PLAIN),
    ("time", "time gh pr create", PLAIN),
    ("sudo with flags (r2)", "sudo -u me gh pr create", PLAIN),
    ("absolute path", "/opt/homebrew/bin/gh pr create", PLAIN),
    ("global flag", "gh -R owner/repo pr create", PLAIN),
    ("long global flag", "gh --repo owner/repo pr create", PLAIN),
    ("pr new alias", "gh pr new --fill", PLAIN),
    ("then", "if git push; then gh pr create; fi", PLAIN),
    ("if (r2)", "if gh pr create --fill; then echo ok; fi", PLAIN),
    ("if not (r2)", "if ! gh pr create --fill; then echo no; fi", PLAIN),
    ("bang (r2)", "! gh pr create", PLAIN),
    ("brace group (r2)", "{ gh pr create; }", PLAIN),
    ("subshell", "(gh pr create)", PLAIN),
    ("substitution", "URL=$(gh pr create --fill)", PLAIN),
    ("backticks", "URL=`gh pr create --fill`", PLAIN),
    ("substitution in quotes", 'echo "$(gh pr create --fill)"', PLAIN),
    ("next line", "git push\ngh pr create --fill", PLAIN),
    ("continuation", "gh \\\npr create --fill", PLAIN),
    ("body heredoc", "gh pr create --body \"$(cat <<'EOF'\nhi\nEOF\n)\"", PLAIN),
    ("after comment w/ apostrophe (r2)", "git push # it's pushed\ngh pr create", PLAIN),
    ("after << in quotes (r2)", 'git commit -m "use <<EOF in docs"\ngh pr create', PLAIN),
    ("after shift in quotes (r2)", "python3 -c 'print(1<<n)'\ngh pr create", PLAIN),
    ("after arithmetic shift (r2)", "echo $((x<<y))\ngh pr create", PLAIN),
    ("after <<- heredoc", "cat <<-EOF\n\tbody\n\tEOF\ngh pr create", PLAIN),
    ("after two heredocs", "cat <<A <<B\na\nA\nb\nB\ngh pr create", PLAIN),
    ("after here-string", "cat <<< 'x'\ngh pr create", PLAIN),
    # ---- opens a PR, but the target commit isn't HEAD of cwd ----
    ("cd first", "cd ../wt && gh pr create", AMBIG),
    ("cd home (r2)", "cd && gh pr create", AMBIG),
    ("chained cd (r2)", "cd a && cd b && gh pr create", AMBIG),
    ("subshell cd (r2)", "(cd sub && make); gh pr create", AMBIG),
    ("pushd", "pushd ../wt && gh pr create", AMBIG),
    ("cd after", "gh pr create; cd ..", AMBIG),
    ("head flag", "gh pr create --head feat/x --fill", AMBIG),
    ("head equals", "gh pr create --head=feat/x", AMBIG),
    ("short head", "gh pr create -H owner:feat/x", AMBIG),
    ("attached short head (r2)", "gh pr create -Hfeat", AMBIG),
    ("head after substitution (r2)",
     'gh pr create --title "$(git log -1 --format=%s)" --head feat/x', AMBIG),
    ("head after continuation (r2)", "gh pr create --fill \\\n  --head feat", AMBIG),
    ("head after body heredoc (r2)",
     "gh pr create --body \"$(cat <<'EOF'\nhi\nEOF\n)\" --head feat", AMBIG),
    # ---- does not open a PR ----
    ("unrelated", "ls -la", None),
    ("apostrophe in comment (r2)", "git status # what's changed", None),
    ("unterminated single quote (r2)", "echo 'oops", None),
    ("unterminated double quote", 'echo "oops', None),
    ("other subcommand", "gh pr view 124", None),
    ("echo double", 'echo "gh pr create --title t"', None),
    ("echo single", "echo 'gh pr create'", None),
    ("argument word do (r2)", "echo do gh pr create", None),
    ("comment mention (r2)", "echo hi # see; gh pr create", None),
    ("commit mention (r1)", "git commit -m 'gate blocks gh pr create'", None),
    ("separator in quotes (r1)", 'git commit -m "docs; gh pr create is gated"', None),
    ("pipe in quotes (r1)", "git commit -m 'x | gh pr create'", None),
    ("commit heredoc (r1)",
     'git commit -m "$(cat <<\'E\'\nfix\n\ngh pr create now gated\nE\n)"', None),
    ("cat heredoc (r1)", "cat <<E\ngh pr create\nE", None),
    ("heredoc paren (r1)", "cat > t.py <<'EOF'\ncases = {\"(gh pr create)\": 1}\nEOF", None),
    ("tab-indented terminator only ends <<- (r2)",
     "cat <<EOF\n\tEOF\ngh pr create\nEOF", None),
    ("hyphenated quoted delimiter (r2)", "cat <<'END-OF'\ngh pr create\nEND-OF", None),
    ("backslash delimiter (r2)", "cat <<\\EOF\ngh pr create\nEOF", None),
    ("python string (r1)", 'python3 -c "print(\'cd wt && gh pr create\')"', None),
    ("grep for it", "grep -rn 'gh pr create' .claude", None),
    ("longer subcommand", "gh pr create-foo", None),
]

LENGTH_SAMPLES = [cmd for _, cmd, _ in CASES]


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


def make_repo(root: Path) -> Path:
    repo = root / "repo"
    repo.mkdir()
    git = ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t"]
    subprocess.run([*git, "init", "-q", "-b", "main"], check=True)
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "a"], check=True)
    return repo


def end_to_end() -> tuple[int, list[str]]:
    ran, failures = 0, []

    def expect(name: str, payload: object, want: str) -> None:
        nonlocal ran
        ran += 1
        got = decision(run_gate(payload))
        if got != want:
            failures.append(f"e2e {name}: expected {want}, got {got}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        repo = make_repo(root)

        def at(path: Path, command: str) -> dict:
            return {"cwd": str(path), "tool_input": {"command": command}}

        expect("unreviewed HEAD", at(repo, "gh pr create --fill"), "deny")
        expect("comment apostrophe passes quietly", at(repo, "ls # it's fine"), "allow")
        subprocess.run(["python3", str(GATE), "--mark"], cwd=repo,
                       capture_output=True, check=True)
        expect("reviewed HEAD", at(repo, "gh pr create --fill"), "allow")
        expect("ambiguous even when reviewed",
               at(repo, "gh pr create --head main"), "deny")
        expect("not a git repo warns", at(root, "gh pr create"), "warn")
        expect("unrelated command", at(repo, "ls"), "allow")

    for name, payload in [
        ("null command", {"tool_input": {"command": None}}),
        ("null tool_input", {"tool_input": None}),
        ("list payload", [1, 2]),
    ]:
        expect(name, payload, "allow")
    return ran, failures


def main() -> None:
    failures = []
    for name, cmd, want in CASES:
        try:
            got = classify(cmd)
        except Exception as exc:  # noqa: BLE001 — a crash is a failure, not an abort
            got = f"{type(exc).__name__}: {exc}"
        if got != want:
            failures.append(f"{name}: {cmd!r}\n    expected {want}, got {got}")
    for cmd in LENGTH_SAMPLES:
        if len(blank_inert(cmd)) != len(cmd):
            failures.append(f"length changed: {cmd!r}")
    ran, e2e_failures = end_to_end()
    failures += e2e_failures
    total = len(CASES) + len(LENGTH_SAMPLES) + ran
    for f in failures:
        print(f"FAIL {f}")
    print(f"{total - len(failures)}/{total} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
