"""Compare embedding models and settings on a real repo.

Every run embeds the *same* first N files (pending_files orders by path, and dense state is reset
between runs), so wall time is directly comparable.

Wall time for a fixed file set is the metric that matters, not chunks/s: the small-chunk filter
removes short chunks, which lowers chunks/s while lowering total time. Reporting only the rate
would make the filter look like a regression.

    uv run python scripts/bench_embedders.py /tmp/polly 80
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from pathlib import Path

from hybrid_retrieval.db import connect, reset_dense, transaction
from hybrid_retrieval.embed import Embedder, embed_pending, pending_count

QWEN = "Qwen/Qwen3-Embedding-0.6B"
# jinaai/jina-embeddings-v2-base-code is NOT usable here: its trust_remote_code module imports
# transformers.pytorch_utils.find_pruneable_heads_and_indices, which modern transformers removed.
# gte-modernbert-base is the closest substitute that needs no remote code at all.
GTE = "Alibaba-NLP/gte-modernbert-base"
BGE_SMALL = "BAAI/bge-small-en-v1.5"


@dataclass
class Case:
    label: str
    model_id: str
    batch_size: int
    min_chunk_tokens: int
    trust_remote_code: bool = False


CASES = [
    Case("qwen3-0.6b     b8   no filter", QWEN, 8, 0),
    Case("qwen3-0.6b     b8   filter>=15", QWEN, 8, 15),
    Case("gte-modernbert b8   filter>=15", GTE, 8, 15),
    Case("gte-modernbert b32  filter>=15", GTE, 32, 15),
    Case("bge-small      b32  filter>=15", BGE_SMALL, 32, 15),
]


def main() -> int:
    repo = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/polly")
    n_files = int(sys.argv[2] if len(sys.argv) > 2 else 80)

    conn = connect(repo)
    total_files = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    total_chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    print(f"repo {repo}: {total_files} files, {total_chunks} chunks")
    print(f"benchmarking the first {n_files} files per case\n")

    results = []
    for case in CASES:
        with transaction(conn):
            reset_dense(conn)
        assert pending_count(conn) == total_files

        load_started = time.perf_counter()
        embedder = Embedder(
            case.model_id,
            batch_size=case.batch_size,
            trust_remote_code=case.trust_remote_code,
        )
        load_s = time.perf_counter() - load_started

        started = time.perf_counter()
        stats = embed_pending(
            repo,
            embedder,
            conn=conn,
            files_per_batch=16,
            limit=n_files,
            min_chunk_tokens=case.min_chunk_tokens,
        )
        wall = time.perf_counter() - started

        # Scale by chunks, not files: files vary hugely in chunk count, so a file-scaled
        # projection silently inherits whatever bias the subset has. Even this is only indicative
        # unless the subset's average chunk length matches the repo's.
        repo_chunks = conn.execute(
            "SELECT COUNT(*) FROM chunks WHERE token_count >= ?", (case.min_chunk_tokens,)
        ).fetchone()[0]
        projected_min = wall * (repo_chunks / max(stats.chunks, 1)) / 60
        results.append((case.label, embedder.dim, stats, wall, load_s, projected_min))
        print(
            f"{case.label}  dim={embedder.dim}  load={load_s:.1f}s  "
            f"{stats.chunks} chunks in {wall:.1f}s "
            f"({stats.chunks / wall:.1f} chunks/s)  "
            f"projected full repo {projected_min:.1f} min",
            flush=True,
        )

        del embedder
        import torch

        torch.cuda.empty_cache()

    print("\n| case | dim | chunks | wall (s) | chunks/s | model load (s) | full repo (min) |")
    print("|---|---|---|---|---|---|---|")
    for label, dim, stats, wall, load_s, projected in results:
        print(
            f"| `{label}` | {dim} | {stats.chunks} | {wall:.1f} | "
            f"{stats.chunks / wall:.1f} | {load_s:.1f} | {projected:.1f} |"
        )

    baseline = results[0][3]
    print("\nspeedup vs baseline (same 80 files):")
    for label, _dim, _stats, wall, _load, _proj in results[1:]:
        print(f"  {label}: {baseline / wall:.2f}x")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
