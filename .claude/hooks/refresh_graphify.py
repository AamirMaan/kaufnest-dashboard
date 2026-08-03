"""Stop hook: keep graphify-out/ in step with the code that just changed.

CLAUDE.md tells the agent to "run `graphify update .` after modifying code", but
nothing enforced that — it was advisory prose, so the graph drifted whenever a
session forgot. Meanwhile the PreToolUse hooks in settings.json push *every*
session to consult graphify before reading source. Orienting new work off a
stale graph is worse than having no graph, because the answers look confident.

This closes that loop: when a turn changed files graphify extracts from, kick
off `graphify update .` in the background. The rebuild is AST-only (no LLM, no
API cost), so it is cheap enough to run on every code-touching turn.

Guards, in the order they fire:
  * no graphify-out/graph.json — the project doesn't use graphify; do nothing.
  * `graphify` not on PATH — do nothing (the CLI is a per-machine install).
  * no extractable files changed — a docs- or config-only turn cannot move the
    graph, so skip the rebuild.
  * lock file — one rebuild at a time; a stale lock (>15 min) is ignored so a
    killed process cannot wedge every future session.

Detached like propose_claude_md.py's reflector: the hook returns immediately and
the rebuild finishes on its own. A `--no-cluster` rebuild is used deliberately —
re-clustering is the slow part and the community labels are stable across
ordinary edits; `graphify cluster-only .` regenerates them when they matter.

Run manually: uv run .claude/hooks/refresh_graphify.py
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _areas import changed_paths, repo_root  # noqa: E402

GRAPH_FILE = "graphify-out/graph.json"
LOCK_FILE = "graphify-out/.refresh.lock"
LOCK_STALE_SECONDS = 15 * 60
LOCK_VAR = "GRAPHIFY_REFRESH_LOCK"

# Mirrors what graphify's extractor actually parses. A change to a .md or .json
# file cannot alter the code graph, so it must not trigger a rebuild.
EXTRACTABLE = (
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".rb", ".sql",
)
IGNORED_PREFIXES = (
    "graphify-out/", "node_modules/", ".worktrees/", ".next/", ".claude/",
)


def code_changed(paths: list[str]) -> bool:
    for path in paths:
        if path.startswith(IGNORED_PREFIXES):
            continue
        if path.endswith(EXTRACTABLE):
            return True
    return False


def lock_is_held(lock: Path) -> bool:
    """True when another rebuild owns the lock and it hasn't gone stale."""
    if not lock.is_file():
        return False
    try:
        age = time.time() - lock.stat().st_mtime
    except OSError:
        return False
    if age < LOCK_STALE_SECONDS:
        return True
    # Stale: a previous rebuild was killed before it could clean up. Reclaim it,
    # otherwise the graph would never refresh again on this machine.
    lock.unlink(missing_ok=True)
    return False


def main() -> None:
    if os.environ.get(LOCK_VAR):
        sys.exit(0)

    # Stop hooks get session JSON on stdin; drain it so the writer never blocks.
    try:
        json.load(sys.stdin)
    except Exception:
        pass

    root = repo_root()
    if root is None or not (root / GRAPH_FILE).is_file():
        sys.exit(0)

    graphify = shutil.which("graphify")
    if not graphify:
        sys.exit(0)

    if not code_changed(changed_paths(root)):
        sys.exit(0)

    lock = root / LOCK_FILE
    if lock_is_held(lock):
        sys.exit(0)

    try:
        lock.write_text(str(int(time.time())), encoding="utf-8")
    except OSError:
        sys.exit(0)

    child_env = os.environ.copy()
    child_env[LOCK_VAR] = "1"

    # `sh -c` so the lock is released whether the rebuild succeeds or fails.
    # --no-cluster keeps this to an AST re-extraction; see the module docstring.
    try:
        subprocess.Popen(
            ["sh", "-c", f'"$0" update . --no-cluster >/dev/null 2>&1; rm -f "$1"',
             graphify, str(lock)],
            env=child_env,
            cwd=root,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
