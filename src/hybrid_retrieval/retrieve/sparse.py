"""Sparse retrieval: FTS5 BM25 plus depth-2 AST expansion (decisions 21 and 22).

Chunk scores roll up to a file by max (decision 15). AST expansion then pulls in structural
neighbours the lexical match never mentioned — the files a hit imports or shares a namespace with
— at a decayed score, so they rank below direct matches but ahead of nothing.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable

from ..db.schema import BM25_WEIGHTS
from ..text import fts_match_query, query_terms
from ..types import Candidate

AST_DECAY = 0.35


def _bm25_expression() -> str:
    weights = ", ".join(str(w) for w in BM25_WEIGHTS)
    return f"bm25(fts_chunks, {weights})"


CHUNKS_PER_FILE_BUDGET = 10


def bm25_files(conn: sqlite3.Connection, prompt: str, *, limit: int) -> dict[str, float]:
    """Best BM25 score per file. Higher is better; SQLite's bm25() is negated here.

    The max-per-file rollup happens in Python, not SQL: bm25() is an FTS5 auxiliary function and
    SQLite rejects it inside an aggregate, including one it flattens a subquery into. The plain
    ranked query below is the supported form, bounded so a common term cannot drag back the whole
    table.
    """
    terms = query_terms(prompt)
    if not terms:
        return {}
    expression = _bm25_expression()
    rows = conn.execute(
        f"SELECT path, -{expression} AS score FROM fts_chunks "
        f"WHERE fts_chunks MATCH ? ORDER BY {expression} LIMIT ?",
        (fts_match_query(terms), limit * CHUNKS_PER_FILE_BUDGET),
    ).fetchall()

    best: dict[str, float] = {}
    for path, score in rows:
        value = float(score)
        if value > best.get(path, float("-inf")):
            best[path] = value
    ordered = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
    return dict(ordered[:limit])


def expand_by_ast(
    conn: sqlite3.Connection, seeds: dict[str, float], *, depth: int
) -> dict[str, tuple[float, int]]:
    """Breadth-first walk over the edge table. Returns path -> (score, hops)."""
    reached: dict[str, tuple[float, int]] = {p: (s, 0) for p, s in seeds.items()}
    frontier = dict(seeds)
    for hop in range(1, max(depth, 0) + 1):
        if not frontier:
            break
        next_frontier: dict[str, float] = {}
        for batch in _batched(sorted(frontier)):
            placeholders = ",".join("?" * len(batch))
            rows = conn.execute(
                f"SELECT src, dst FROM edges WHERE src IN ({placeholders})", batch
            ).fetchall()
            for src, dst in rows:
                score = frontier[src] * (AST_DECAY**hop)
                current = reached.get(dst)
                if current is None or score > current[0]:
                    reached[dst] = (score, hop)
                    if dst not in seeds:
                        next_frontier[dst] = max(next_frontier.get(dst, 0.0), score)
        frontier = next_frontier
    return reached


def _batched(items: list[str], size: int = 400) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def sparse_candidates(
    conn: sqlite3.Connection, prompt: str, *, limit: int, ast_depth: int = 2
) -> list[Candidate]:
    """Ranked files for a prompt, lexical hits first, structural neighbours behind them."""
    seeds = bm25_files(conn, prompt, limit=limit)
    if not seeds:
        return []
    reached = expand_by_ast(conn, seeds, depth=ast_depth) if ast_depth > 0 else {
        p: (s, 0) for p, s in seeds.items()
    }
    ordered = sorted(reached.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))
    return [
        Candidate(path=path, sparse_score=score, sparse_rank=rank, ast_hops=hops)
        for rank, (path, (score, hops)) in enumerate(ordered[:limit])
    ]
