"""Context assembly (decisions 29 and 30).

Full file contents, uncapped by default. ``max_tokens`` exists in config and defaults to null; when
it is set, whole files are added by rank until the budget is spent rather than truncating one
mid-way, so the model never sees a doctored file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..lang import estimate_tokens
from ..types import Candidate

HEADER = (
    "Files retrieved from this repository by local hybrid retrieval "
    "(dense + BM25 + import graph). They are a ranked guess, not a constraint."
)


@dataclass(frozen=True, slots=True)
class ContextPack:
    text: str
    paths: list[str] = field(default_factory=list)
    tokens: int = 0
    dropped: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.paths


def assemble(
    repo_root: Path | str,
    candidates: list[Candidate],
    *,
    top_n: int,
    max_tokens: int | None = None,
) -> ContextPack:
    repo_root = Path(repo_root)
    blocks: list[str] = []
    included: list[str] = []
    dropped: list[str] = []
    total = estimate_tokens(HEADER)

    for candidate in candidates[:top_n]:
        try:
            content = (repo_root / candidate.path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            dropped.append(candidate.path)
            continue

        cost = estimate_tokens(content) + 8
        if max_tokens is not None and included and total + cost > max_tokens:
            dropped.append(candidate.path)
            continue

        blocks.append(f"--- {candidate.path} ---\n{content}")
        included.append(candidate.path)
        total += cost

    if not included:
        return ContextPack(text="", paths=[], tokens=0, dropped=dropped)

    body = "\n\n".join(blocks)
    text = f"<retrieved-context>\n{HEADER}\n\n{body}\n</retrieved-context>"
    return ContextPack(text=text, paths=included, tokens=total, dropped=dropped)
