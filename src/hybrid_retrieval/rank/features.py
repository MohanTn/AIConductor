"""Feature extraction for the reranker (decision 24, spec section 5.5).

Every feature is cheap: it comes from the index, from the candidate's existing retrieval scores,
or from an in-memory commit history. Nothing here reads a file or calls a model, because this runs
on 50 candidates inside a 3 second budget.

Git features take an ``as_of`` timestamp. During training that is the parent of the commit being
predicted; at serving time it is now. Passing HEAD-time values while training on a past commit
would leak the label into the features.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import PurePosixPath

import numpy as np

from ..gitlog import History
from ..text import split_identifier
from ..types import Candidate

FEATURE_NAMES: tuple[str, ...] = (
    "dense_score",
    "dense_rank",
    "sparse_score",
    "sparse_rank",
    "rrf_score",
    "n_matching_chunks",
    "ast_hops",
    "ast_in_degree",
    "ast_out_degree",
    "path_token_overlap",
    "path_exact_hit",
    "symbol_exact_match",
    "file_tokens",
    "chunk_count",
    "is_test",
    "is_generated",
    "lang_match",
    "is_doc",
    "is_config",
    "is_script",
    "git_days_since_touch",
    "git_churn_90d",
)

# Prose matches prose, so a README lexically matches almost any prompt. Measured on held-out
# prompts, markdown was injected into 117 top-5 slots while only 61 were ever needed, at 30%
# precision, and shell managed 8%. A single "matches the dominant language" flag cannot express
# that, so the model gets the categories directly and learns the discount itself.
DOC_LANGS = frozenset({"markdown"})
CONFIG_LANGS = frozenset({"toml", "yaml", "json"})
SCRIPT_LANGS = frozenset({"shell"})

MISSING_RANK = 999.0
MISSING_DAYS = 3650.0
DAY = 86400
NINETY_DAYS = 90 * DAY

_TEST_MARKERS = ("test", "tests", "spec", "specs", "__tests__")
_GENERATED_MARKERS = (".g.cs", ".designer.cs", ".generated.", "_pb2.", ".pb.go")


@dataclass
class FeatureContext:
    """Per-file data for a candidate set, loaded in bulk rather than per row."""

    chunk_count: dict[str, int] = field(default_factory=dict)
    file_tokens: dict[str, int] = field(default_factory=dict)
    symbols: dict[str, set[str]] = field(default_factory=dict)
    in_degree: dict[str, int] = field(default_factory=dict)
    out_degree: dict[str, int] = field(default_factory=dict)
    lang: dict[str, str] = field(default_factory=dict)
    dominant_lang: str = ""

    @classmethod
    def load(cls, conn: sqlite3.Connection, paths: list[str]) -> FeatureContext:
        ctx = cls()
        if not paths:
            return ctx

        row = conn.execute(
            "SELECT lang FROM files GROUP BY lang ORDER BY COUNT(*) DESC LIMIT 1"
        ).fetchone()
        ctx.dominant_lang = row[0] if row else ""

        for batch in _batched(paths):
            placeholders = ",".join("?" * len(batch))
            for path, lang in conn.execute(
                f"SELECT path, lang FROM files WHERE path IN ({placeholders})", batch
            ):
                ctx.lang[path] = lang
            for path, count, tokens in conn.execute(
                f"SELECT path, COUNT(*), COALESCE(SUM(token_count), 0) FROM chunks "
                f"WHERE path IN ({placeholders}) GROUP BY path",
                batch,
            ):
                ctx.chunk_count[path] = count
                ctx.file_tokens[path] = tokens
            for path, name in conn.execute(
                f"SELECT path, name FROM symbols WHERE path IN ({placeholders})", batch
            ):
                ctx.symbols.setdefault(path, set()).add(name.lower())
            for src, count in conn.execute(
                f"SELECT src, COUNT(*) FROM edges WHERE src IN ({placeholders}) GROUP BY src",
                batch,
            ):
                ctx.out_degree[src] = count
            for dst, count in conn.execute(
                f"SELECT dst, COUNT(*) FROM edges WHERE dst IN ({placeholders}) GROUP BY dst",
                batch,
            ):
                ctx.in_degree[dst] = count
        return ctx


def _batched(items: list[str], size: int = 400):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def path_tokens(path: str) -> set[str]:
    parts = PurePosixPath(path).parts
    stem = PurePosixPath(path).stem
    tokens: set[str] = set()
    for part in (*parts[:-1], stem):
        tokens.add(part.lower())
        tokens.update(split_identifier(part))
    return {t for t in tokens if t}


def _is_test(path: str) -> float:
    lowered = path.lower()
    parts = set(PurePosixPath(lowered).parts)
    if parts & set(_TEST_MARKERS):
        return 1.0
    stem = PurePosixPath(lowered).stem
    return 1.0 if stem.endswith("test") or stem.endswith("tests") else 0.0


def _is_generated(path: str) -> float:
    lowered = path.lower()
    return 1.0 if any(marker in lowered for marker in _GENERATED_MARKERS) else 0.0


def extract(
    candidates: list[Candidate],
    *,
    query_terms: list[str],
    ctx: FeatureContext,
    history: History | None = None,
    as_of: int | None = None,
) -> np.ndarray:
    """Feature matrix, one row per candidate, columns in FEATURE_NAMES order."""
    terms = set(query_terms)
    rows: list[list[float]] = []

    for candidate in candidates:
        path = candidate.path
        lang = ctx.lang.get(path, "")
        tokens = path_tokens(path)
        overlap = len(tokens & terms) / len(terms) if terms else 0.0
        stem = PurePosixPath(path).stem.lower()
        exact_path = 1.0 if stem in terms else 0.0
        symbols = ctx.symbols.get(path, set())
        symbol_hit = 1.0 if symbols & terms else 0.0

        days_since = MISSING_DAYS
        churn = 0.0
        if history is not None and as_of is not None:
            touched = history.last_touched_before(path, as_of)
            if touched is not None:
                days_since = max(0.0, (as_of - touched) / DAY)
            churn = float(history.churn_between(path, as_of - NINETY_DAYS, as_of))

        rows.append(
            [
                candidate.dense_score,
                float(candidate.dense_rank if candidate.dense_rank is not None else MISSING_RANK),
                candidate.sparse_score,
                float(
                    candidate.sparse_rank if candidate.sparse_rank is not None else MISSING_RANK
                ),
                candidate.rrf_score,
                float(candidate.n_matching_chunks),
                float(candidate.ast_hops if candidate.ast_hops is not None else MISSING_RANK),
                float(ctx.in_degree.get(path, 0)),
                float(ctx.out_degree.get(path, 0)),
                overlap,
                exact_path,
                symbol_hit,
                float(ctx.file_tokens.get(path, 0)),
                float(ctx.chunk_count.get(path, 0)),
                _is_test(path),
                _is_generated(path),
                1.0 if lang == ctx.dominant_lang else 0.0,
                1.0 if lang in DOC_LANGS else 0.0,
                1.0 if lang in CONFIG_LANGS else 0.0,
                1.0 if lang in SCRIPT_LANGS else 0.0,
                days_since,
                churn,
            ]
        )

    if not rows:
        return np.empty((0, len(FEATURE_NAMES)), dtype=np.float32)
    return np.asarray(rows, dtype=np.float32)
