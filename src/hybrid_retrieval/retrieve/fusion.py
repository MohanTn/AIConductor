"""Reciprocal rank fusion (decision 23).

The diagram unions two 100-item lists and then takes the top 100, which removes nothing. The cut
here is real: fuse, then keep ``limit`` (default 50), which halves the work every later stage has
to do.

RRF is rank-based on purpose. Dense cosine similarity and BM25 are not on comparable scales, and
normalising them against each other requires calibration data we do not have yet.
"""

from __future__ import annotations

from ..types import Candidate

DEFAULT_RRF_K = 60


def rrf_fuse(
    dense: list[Candidate],
    sparse: list[Candidate],
    *,
    k: int = DEFAULT_RRF_K,
    limit: int = 50,
) -> list[Candidate]:
    merged: dict[str, Candidate] = {}

    for candidate in dense:
        merged[candidate.path] = candidate
    for candidate in sparse:
        existing = merged.get(candidate.path)
        if existing is None:
            merged[candidate.path] = candidate
        else:
            merged[candidate.path] = Candidate(
                path=candidate.path,
                dense_score=existing.dense_score,
                dense_rank=existing.dense_rank,
                sparse_score=candidate.sparse_score,
                sparse_rank=candidate.sparse_rank,
                ast_hops=candidate.ast_hops if existing.ast_hops is None else existing.ast_hops,
                n_matching_chunks=max(existing.n_matching_chunks, candidate.n_matching_chunks),
            )

    scored: list[Candidate] = []
    for path, candidate in merged.items():
        score = 0.0
        if candidate.dense_rank is not None:
            score += 1.0 / (k + candidate.dense_rank + 1)
        if candidate.sparse_rank is not None:
            score += 1.0 / (k + candidate.sparse_rank + 1)
        scored.append(
            Candidate(
                path=path,
                dense_score=candidate.dense_score,
                dense_rank=candidate.dense_rank,
                sparse_score=candidate.sparse_score,
                sparse_rank=candidate.sparse_rank,
                rrf_score=score,
                ast_hops=candidate.ast_hops,
                n_matching_chunks=candidate.n_matching_chunks,
            )
        )

    scored.sort(key=lambda c: (-c.rrf_score, c.path))
    return scored[:limit]
