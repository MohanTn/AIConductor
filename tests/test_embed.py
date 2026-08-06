"""Embedding storage and dense retrieval, exercised with a deterministic fake model.

The real model is 1.2GB and needs a GPU; none of the logic under test here is model-specific.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pytest

from conftest import write
from hybrid_retrieval.config import Config
from hybrid_retrieval.db import EmbedderMismatch, connect, dense_config, is_vec_available
from hybrid_retrieval.embed import (
    embed_pending,
    format_query,
    from_float32,
    normalise,
    pending_count,
    to_float32,
    to_int8,
)
from hybrid_retrieval.index import index_repo
from hybrid_retrieval.retrieve import dense_candidates, retrieve

needs_vec = pytest.mark.skipif(not is_vec_available(), reason="sqlite-vec not loadable here")

VOCAB = ("token", "refresh", "jwt", "invoice", "render", "billing", "auth", "retry")


class FakeEmbedder:
    """Bag-of-words over a fixed vocabulary, so similarity is predictable by hand."""

    model_id = "fake/bow"

    @property
    def dim(self) -> int:
        return len(VOCAB)

    def _vector(self, text: str) -> np.ndarray:
        lowered = text.lower()
        raw = np.array([float(lowered.count(word)) for word in VOCAB], dtype=np.float32)
        if not raw.any():
            raw = np.ones(len(VOCAB), dtype=np.float32)
        return normalise(raw)

    def encode_documents(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._vector(t) for t in texts]) if texts else np.empty((0, self.dim))

    def encode_query(self, prompt: str) -> np.ndarray:
        return self._vector(prompt)


JWT = """namespace Api.Auth;

public class JwtService
{
    public string RefreshToken(string token) => token;
}
"""

INVOICE = """namespace Api.Billing;

public class InvoiceRenderer
{
    public string Render(int invoice) => invoice.ToString();
}
"""


@pytest.fixture
def repo(git_repo: Path) -> Path:
    write(git_repo, "src/JwtService.cs", JWT)
    write(git_repo, "src/InvoiceRenderer.cs", INVOICE)
    return git_repo


@pytest.fixture
def conn(repo: Path) -> sqlite3.Connection:
    c = connect(repo)
    index_repo(repo, conn=c)
    yield c
    c.close()


# -- quantisation -----------------------------------------------------------


def test_normalise_produces_unit_vectors():
    vector = normalise(np.array([3.0, 4.0], dtype=np.float32))
    assert np.isclose(np.linalg.norm(vector), 1.0)


def test_int8_is_one_byte_per_dimension():
    vector = normalise(np.ones(1024, dtype=np.float32))
    assert len(to_int8(vector)) == 1024


def test_int8_round_trip_is_close_enough():
    rng = np.random.default_rng(0)
    vector = normalise(rng.normal(size=256).astype(np.float32))
    restored = np.frombuffer(to_int8(vector), dtype=np.int8).astype(np.float32) / 127.0
    assert float(np.dot(normalise(restored), vector)) > 0.999, "int8 must preserve ranking"


def test_int8_clips_out_of_range_values():
    vector = np.array([2.0, -2.0], dtype=np.float32)  # not normalised on purpose
    assert np.frombuffer(to_int8(vector), dtype=np.int8).tolist() == [127, -128]


def test_float32_round_trip_is_exact():
    vector = normalise(np.arange(16, dtype=np.float32))
    assert np.array_equal(from_float32(to_float32(vector)), vector)


def test_query_gets_an_instruction_prefix_and_documents_do_not():
    """Qwen3 is asymmetric (decision 13); getting this backwards costs recall silently."""
    formatted = format_query("rotate refresh tokens")
    assert formatted.startswith("Instruct:")
    assert "Query: rotate refresh tokens" in formatted


# -- backfill ---------------------------------------------------------------


@needs_vec
def test_backfill_embeds_pending_files(repo: Path, conn: sqlite3.Connection):
    assert pending_count(conn) == 2
    stats = embed_pending(repo, FakeEmbedder(), conn=conn)
    assert stats.files == 2
    assert stats.chunks > 0
    assert pending_count(conn) == 0
    assert conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0] == stats.chunks
    assert conn.execute("SELECT COUNT(*) FROM chunk_vectors").fetchone()[0] == stats.chunks
    assert dense_config(conn) == ("fake/bow", len(VOCAB))


@needs_vec
def test_backfill_is_idempotent(repo: Path, conn: sqlite3.Connection):
    embed_pending(repo, FakeEmbedder(), conn=conn)
    assert embed_pending(repo, FakeEmbedder(), conn=conn).files == 0


@needs_vec
def test_reindexing_a_file_makes_it_pending_again(repo: Path, conn: sqlite3.Connection):
    embed_pending(repo, FakeEmbedder(), conn=conn)
    write(repo, "src/JwtService.cs", JWT.replace("RefreshToken", "RotateToken"))
    index_repo(repo, conn=conn, paths=["src/JwtService.cs"])
    assert pending_count(conn) == 1, "edited files must be re-embedded"
    assert embed_pending(repo, FakeEmbedder(), conn=conn).files == 1


@needs_vec
def test_small_chunk_filter_skips_trivial_chunks(repo: Path, conn: sqlite3.Connection):
    unfiltered = embed_pending(repo, FakeEmbedder(), conn=conn, min_chunk_tokens=0)
    conn.execute("UPDATE files SET dense_ready = 0")
    conn.execute("DELETE FROM chunk_vectors")
    conn.execute("DELETE FROM vec_chunks")

    filtered = embed_pending(repo, FakeEmbedder(), conn=conn, min_chunk_tokens=15)
    assert filtered.chunks < unfiltered.chunks, "trivial chunks should be skipped"
    assert filtered.files == unfiltered.files, "every file is still accounted for"


@needs_vec
def test_filtered_chunks_stay_searchable_by_bm25(repo: Path, conn: sqlite3.Connection):
    """The filter is a dense-layer decision; exact identifier search must still find them."""
    from hybrid_retrieval.retrieve import bm25_files

    embed_pending(repo, FakeEmbedder(), conn=conn, min_chunk_tokens=1000)  # skip everything
    assert conn.execute("SELECT COUNT(*) FROM chunk_vectors").fetchone()[0] == 0
    assert "src/JwtService.cs" in bm25_files(conn, "RefreshToken", limit=5)


@needs_vec
def test_file_with_only_trivial_chunks_is_still_marked_done(repo: Path, conn: sqlite3.Connection):
    """Otherwise the backfill loop retries it forever."""
    stats = embed_pending(repo, FakeEmbedder(), conn=conn, min_chunk_tokens=100_000)
    assert stats.chunks == 0
    assert pending_count(conn) == 0


@needs_vec
def test_concurrent_embedders_do_not_duplicate_work(repo: Path, conn: sqlite3.Connection):
    """The daemon backfills continuously while `embed` may be run by hand on the same index."""
    from hybrid_retrieval.embed.backfill import _embed_lock

    with _embed_lock(repo) as acquired:
        assert acquired
        stats = embed_pending(repo, FakeEmbedder(), conn=conn)
    assert stats.files == 0, "second embedder must back off, not duplicate every forward pass"
    assert pending_count(conn) == 2, "and must not have marked anything done"


@needs_vec
def test_swapping_the_model_is_refused(repo: Path, conn: sqlite3.Connection):
    embed_pending(repo, FakeEmbedder(), conn=conn)

    class Other(FakeEmbedder):
        model_id = "fake/other"

    with pytest.raises(EmbedderMismatch):
        embed_pending(repo, Other(), conn=conn)


# -- dense retrieval --------------------------------------------------------


@needs_vec
def test_dense_ranks_the_semantically_closer_file_first(repo: Path, conn: sqlite3.Connection):
    embedder = FakeEmbedder()
    embed_pending(repo, embedder, conn=conn)
    candidates = dense_candidates(conn, embedder.encode_query("refresh token jwt"), limit=5)
    assert candidates[0].path == "src/JwtService.cs"
    assert candidates[0].dense_rank == 0
    assert candidates[0].dense_score > 0


@needs_vec
def test_dense_returns_nothing_on_an_empty_index(git_repo: Path):
    c = connect(git_repo)
    try:
        from hybrid_retrieval.db import ensure_vec_table

        ensure_vec_table(c, embedder_id="fake/bow", dim=len(VOCAB))
        assert dense_candidates(c, FakeEmbedder().encode_query("anything"), limit=5) == []
    finally:
        c.close()


@needs_vec
def test_pipeline_uses_dense_when_embeddings_exist(repo: Path, conn: sqlite3.Connection):
    embedder = FakeEmbedder()
    embed_pending(repo, embedder, conn=conn)
    result = retrieve(repo, "refresh token", conn=conn, embedder=embedder, cfg=Config())
    assert result.dense_used is True
    assert "embed" in result.stage_ms and "dense" in result.stage_ms
    assert result.paths[0] == "src/JwtService.cs"


@needs_vec
def test_pipeline_stays_sparse_until_something_is_embedded(repo: Path, conn: sqlite3.Connection):
    """dense_ready is per file, so a half-embedded index must not pretend to be dense."""
    result = retrieve(repo, "refresh token", conn=conn, embedder=FakeEmbedder(), cfg=Config())
    assert result.dense_used is False
