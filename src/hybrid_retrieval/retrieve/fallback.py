"""Deterministic ripgrep fallback for LOW confidence (decision 28).

Always ripgrep (`rg`), never POSIX grep: `rg` honours .gitignore, skips binaries, and is fast
enough to run several passes inside the request budget. If `rg` is missing the fallback returns
nothing rather than silently substituting a slower tool with different ignore semantics —
`hybrid-retrieval doctor` checks for it.

When the gate is not confident, the learned ranking is replaced wholesale. That is a deliberate
trade: reliably right for identifier-shaped prompts ("rename IUserStore"), useless for conceptual
ones ("improve error handling"), which will look broken and is working as designed.

This is the same function the benchmark uses as its B0 baseline, on purpose. The thing the
pipeline falls back to and the thing it has to beat should not be two different implementations.
"""

from __future__ import annotations

import subprocess
from collections import defaultdict
from pathlib import Path

from ..text import query_terms
from ..types import Candidate

MAX_TERMS = 8
MIN_TERM_LENGTH = 3


def ripgrep_paths(
    repo_root: Path | str,
    prompt: str,
    *,
    limit: int = 50,
    allowed: set[str] | None = None,
    timeout: float = 5.0,
) -> list[str]:
    """Files matching the prompt's identifiers, best first.

    Ranked by how many distinct query terms matched, then by how selective those terms were: a
    term appearing in 200 files says less than one appearing in three.
    """
    terms = [t for t in query_terms(prompt) if len(t) >= MIN_TERM_LENGTH][:MAX_TERMS]
    if not terms:
        return []

    term_hits: dict[str, set[str]] = {}
    for term in terms:
        try:
            proc = subprocess.run(
                ["rg", "-l", "-i", "--fixed-strings", term],
                cwd=str(repo_root),
                capture_output=True,
                timeout=timeout,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        paths = {
            line
            for line in proc.stdout.decode("utf-8", "replace").splitlines()
            if line and (allowed is None or line in allowed)
        }
        if paths:
            term_hits[term] = paths

    matched: dict[str, int] = defaultdict(int)
    for paths in term_hits.values():
        for path in paths:
            matched[path] += 1

    breadth = {term: len(paths) for term, paths in term_hits.items()}

    def selectivity(path: str) -> int:
        return sum(breadth[term] for term, paths in term_hits.items() if path in paths)

    ordered = sorted(matched, key=lambda p: (-matched[p], selectivity(p), p))
    return ordered[:limit]


def ripgrep_candidates(
    repo_root: Path | str,
    prompt: str,
    *,
    limit: int = 50,
    allowed: set[str] | None = None,
) -> list[Candidate]:
    paths = ripgrep_paths(repo_root, prompt, limit=limit, allowed=allowed)
    total = len(paths)
    return [
        # Descending synthetic scores so the gate's margin logic still has something to read.
        Candidate(path=path, model_score=float(total - rank), sparse_rank=rank)
        for rank, path in enumerate(paths)
    ]
