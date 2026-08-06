"""Add the index directory to .gitignore in every repo that has session history.

The index lives inside the repo (decision 11), so without this it shows up as untracked noise in
`git status` for every repo the daemon has ever touched.

    uv run python scripts/add_gitignore.py [--dry-run]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hybrid_retrieval.paths import INDEX_DIRNAME  # noqa: E402
from hybrid_retrieval.sessions import group_by_repo, mine  # noqa: E402

ENTRY = f"{INDEX_DIRNAME}/"
BANNER = "# local hybrid-retrieval index"


def ensure(repo: Path, *, dry_run: bool) -> str:
    gitignore = repo / ".gitignore"
    existing = gitignore.read_text() if gitignore.exists() else ""
    lines = {line.strip() for line in existing.splitlines()}
    if ENTRY in lines or INDEX_DIRNAME in lines:
        return "already present"
    if dry_run:
        return "would add"
    prefix = "" if not existing or existing.endswith("\n") else "\n"
    with open(gitignore, "a") as handle:
        handle.write(f"{prefix}\n{BANNER}\n{ENTRY}\n")
    return "added"


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    repos = sorted({r for r in group_by_repo(mine()) if r.is_dir()})
    if not repos:
        print("no repos found in session history")
        return 1
    for repo in repos:
        print(f"  {ensure(repo, dry_run=dry_run):<15} {repo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
