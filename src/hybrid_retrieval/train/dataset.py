"""Turn git history into labelled ranking examples (decision 25).

Each eligible commit becomes one query: the subject line is the query, the files it changed are
the positives, and the candidate set is whatever retrieval returns for that subject.

Two properties matter and are easy to get wrong:

  * **Point-in-time features.** ``as_of`` is the commit's own timestamp, and the history helpers
    use a strict "before" comparison, so the commit being predicted never contributes to its own
    recency or churn features.
  * **The retrieval ceiling.** A commit whose files never appear in the candidate set cannot be
    learned from and is dropped. The drop rate is reported, because it is an upper bound on what
    any reranker can achieve — no amount of reranking recovers a candidate that was never
    generated.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..config import Config
from ..gitlog import Commit, History
from ..rank.features import FeatureContext, extract
from ..retrieve.pipeline import generate_candidates
from ..text import query_terms
from ..types import Candidate


@dataclass(frozen=True, slots=True)
class LabelledQuery:
    """One training query, whatever mined it.

    ``as_of`` is the moment the query was asked, and every point-in-time feature is computed
    strictly before it.
    """

    query: str
    gold: frozenset[str]
    as_of: int
    source: str = ""


def from_commit(commit: Commit) -> LabelledQuery:
    return LabelledQuery(
        query=commit.subject,
        gold=frozenset(commit.files),
        as_of=commit.timestamp,
        source="git",
    )


def from_session(example, *, target: str = "touched") -> LabelledQuery:
    """``target`` selects the label: 'edited' is the strong signal, 'touched' adds reads."""
    gold = example.edited_paths if target == "edited" else example.touched
    return LabelledQuery(
        query=example.prompt,
        gold=frozenset(gold),
        as_of=example.timestamp,
        source="session",
    )


@dataclass
class Example:
    query: str
    gold: set[str]
    as_of: int
    candidates: list[Candidate]
    matrix: np.ndarray
    labels: np.ndarray
    source: str = ""

    @property
    def n_positive(self) -> int:
        return int(self.labels.sum())


@dataclass
class BuildStats:
    considered: int = 0
    built: int = 0
    dropped_no_candidates: int = 0
    dropped_no_positive: int = 0
    ceiling_paths: list[float] = field(default_factory=list)

    @property
    def ceiling(self) -> float:
        """Mean fraction of gold files that retrieval managed to surface at all."""
        return sum(self.ceiling_paths) / len(self.ceiling_paths) if self.ceiling_paths else 0.0

    def __str__(self) -> str:
        return (
            f"{self.built}/{self.considered} usable "
            f"(dropped {self.dropped_no_candidates} empty, {self.dropped_no_positive} unreachable)"
            f", retrieval ceiling {self.ceiling:.1%}"
        )


def build_examples(
    conn: sqlite3.Connection,
    queries: list[LabelledQuery],
    *,
    history: History,
    cfg: Config,
    embedder=None,
    progress=None,
) -> tuple[list[Example], BuildStats]:
    examples: list[Example] = []
    stats = BuildStats(considered=len(queries))

    for index, item in enumerate(queries, start=1):
        generated = generate_candidates(conn, item.query, cfg=cfg, embedder=embedder)
        candidates = generated.candidates
        if not candidates:
            stats.dropped_no_candidates += 1
            continue

        gold = set(item.gold)
        found = {c.path for c in candidates} & gold
        stats.ceiling_paths.append(len(found) / len(gold) if gold else 0.0)
        if not found:
            stats.dropped_no_positive += 1
            continue

        ctx = FeatureContext.load(conn, [c.path for c in candidates])
        matrix = extract(
            candidates,
            query_terms=query_terms(item.query),
            ctx=ctx,
            history=history,
            as_of=item.as_of,
        )
        labels = np.array([1.0 if c.path in gold else 0.0 for c in candidates], dtype=np.float32)
        examples.append(
            Example(
                query=item.query,
                gold=gold,
                as_of=item.as_of,
                candidates=candidates,
                matrix=matrix,
                labels=labels,
                source=item.source,
            )
        )
        stats.built += 1
        if progress is not None:
            progress(index, len(queries))

    return examples, stats


def split_by_time(items: list, *, holdout: int) -> tuple[list, list]:
    """Oldest train, newest held out. Never shuffle: that lets the model learn from the future."""
    key = (
        (lambda x: x.timestamp)
        if items and hasattr(items[0], "timestamp")
        else (lambda x: x.as_of)
    )
    ordered = sorted(items, key=key)
    if holdout <= 0 or holdout >= len(ordered):
        return ordered, []
    return ordered[:-holdout], ordered[-holdout:]


def eligible_commits(
    repo_root: Path | str,
    conn: sqlite3.Connection,
    history: History,
    *,
    max_files: int = 15,
) -> list[Commit]:
    indexed = {row[0] for row in conn.execute("SELECT path FROM files")}
    return history.eligible(max_files=max_files, keep=indexed)
