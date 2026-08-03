"""Shared git/area helpers for the doc-drift hooks.

`session_start_context.py`, `propose_claude_md.py` and `reflect_claude_md.py`
all need the same two things: which folders own a CLAUDE.md/SKILL.md, and which
of them a set of changed paths falls into. That logic lives here so the three
hooks cannot drift apart from each other.

Deliberately dependency-free (stdlib only) so `uv run` can execute an importing
hook without resolving a package environment first.
"""
import subprocess
from pathlib import Path

# Per AGENTS.md, a feature's docs are a pair: CLAUDE.md is the file map,
# SKILL.md is the agent playbook. Both go stale from the same code change, so
# both define a "governed area".
DOC_FILENAMES = ("CLAUDE.md", "SKILL.md")


def git(*args: str, cwd: Path | None = None) -> str:
    """Run a git command, returning trimmed stdout ("" on any failure)."""
    result = subprocess.run(
        ["git", *args], capture_output=True, text=True, cwd=cwd
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def git_lines(*args: str, cwd: Path | None = None) -> list[str]:
    """Run a git command that emits NUL-separated paths, returning them as a list.

    `-z` output is used wherever paths are involved: git quotes and escapes
    paths containing spaces or non-ASCII in its default output, which silently
    corrupts naive line parsing.
    """
    out = subprocess.run(
        ["git", *args], capture_output=True, text=True, cwd=cwd
    )
    if out.returncode != 0:
        return []
    return [p for p in out.stdout.split("\0") if p]


def repo_root() -> Path | None:
    top = git("rev-parse", "--show-toplevel")
    return Path(top) if top else None


def governed_areas(root: Path) -> list[str]:
    """Repo-relative directories that own a CLAUDE.md or SKILL.md.

    Enumerated via `git ls-files` rather than `Path.rglob` on purpose: rglob
    walks ignored trees, which in this repo means a 750MB `node_modules/` (whose
    packages ship their own SKILL.md files) plus every checkout under
    `.worktrees/`. That is both slow on a hook that runs every turn and wrong —
    those docs are not ours to keep current.

    The repo-root docs are excluded; they govern everything, so treating them as
    an "area" would just mark every change as touching them. Callers that want
    root CLAUDE.md/AGENTS.md read them directly.
    """
    areas: set[str] = set()
    for filename in DOC_FILENAMES:
        for rel_path in git_lines("ls-files", "-z", "--", f"*{filename}", cwd=root):
            parent = str(Path(rel_path).parent)
            if parent in (".", ""):
                continue  # repo-root docs — see docstring
            if parent.split("/")[0] == ".claude":
                continue  # hook config, not a feature area
            areas.add(parent)
    return sorted(areas)


def areas_touched_by(paths: list[str], areas: list[str]) -> list[str]:
    """Every governed area containing at least one of `paths`.

    Nesting is intentional: a change under `src/app/dashboard/sales/` reports
    both `src/app/dashboard/sales` and its parent `src/app/dashboard`, because
    the parent's CLAUDE.md carries the feature table that a new route or slice
    would also invalidate.
    """
    hits = set()
    for path in paths:
        for area in areas:
            if path == area or path.startswith(f"{area}/"):
                hits.add(area)
    return sorted(hits)


def area_doc_paths(root: Path, area: str) -> list[Path]:
    """Existing CLAUDE.md / SKILL.md files for one area."""
    return [p for p in (root / area / name for name in DOC_FILENAMES) if p.is_file()]


def changed_paths(root: Path) -> list[str]:
    """Tracked modifications (staged + unstaged) plus untracked files.

    Untracked files matter as much as edits here: adding a new component or
    slice is exactly the change that invalidates a CLAUDE.md file map, and
    `git diff HEAD` alone never sees it.
    """
    tracked = git_lines("diff", "-z", "--name-only", "HEAD", cwd=root)
    untracked = git_lines(
        "ls-files", "-z", "--others", "--exclude-standard", cwd=root
    )
    return list(dict.fromkeys(tracked + untracked))


def is_doc_only(paths: list[str]) -> bool:
    """True when the only changes are to the doc files themselves.

    Claude updating CLAUDE.md/SKILL.md at the end of a task is the expected
    outcome, not drift worth another review pass.
    """
    return bool(paths) and all(
        Path(p).name in DOC_FILENAMES or p in ("AGENTS.md",) for p in paths
    )
