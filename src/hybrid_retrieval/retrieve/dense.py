"""Dense retrieval: coarse int8 scan, exact float32 rescore (decision 10).

sqlite-vec has no ANN index, so the int8 KNN is a linear scan. It runs at one byte per dimension
instead of four, and the exact cosine is then recomputed for only ``rescore_k`` survivors, which
is where the ranking actually comes from. Chunk scores roll up to a file by max (decision 15).
"""

from __future__ import annotations

import sqlite3

import numpy as np

from ..embed.quantize import from_float32, to_int8
from ..types import Candidate


def dense_candidates(
    conn: sqlite3.Connection,
    query_vec: np.ndarray,
    *,
    limit: int,
    rescore_k: int = 200,
) -> list[Candidate]:
    rows = conn.execute(
        "SELECT chunk_id FROM vec_chunks "
        "WHERE embedding MATCH vec_int8(?) AND k = ? ORDER BY distance",
        (to_int8(query_vec), rescore_k),
    ).fetchall()
    if not rows:
        return []

    chunk_ids = [row[0] for row in rows]
    placeholders = ",".join("?" * len(chunk_ids))
    exact = conn.execute(
        f"SELECT cv.chunk_id, cv.vec, c.path FROM chunk_vectors cv "
        f"JOIN chunks c ON c.id = cv.chunk_id WHERE cv.chunk_id IN ({placeholders})",
        chunk_ids,
    ).fetchall()

    query = np.asarray(query_vec, dtype=np.float32)
    best: dict[str, float] = {}
    hits: dict[str, int] = {}
    for _chunk_id, blob, path in exact:
        # Both sides are L2-normalised, so the dot product is the cosine similarity.
        score = float(np.dot(from_float32(blob), query))
        hits[path] = hits.get(path, 0) + 1
        if score > best.get(path, float("-inf")):
            best[path] = score

    ordered = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
    return [
        Candidate(
            path=path,
            dense_score=score,
            dense_rank=rank,
            n_matching_chunks=hits[path],
        )
        for rank, (path, score) in enumerate(ordered[:limit])
    ]
