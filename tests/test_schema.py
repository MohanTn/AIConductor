from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from hybrid_retrieval.db import (
    SCHEMA_VERSION,
    EmbedderMismatch,
    apply_schema,
    connect,
    dense_config,
    ensure_vec_table,
    is_vec_available,
    reset_dense,
    schema_version,
)

DIM = 1024
needs_vec = pytest.mark.skipif(not is_vec_available(), reason="sqlite-vec not loadable here")


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    apply_schema(c)
    yield c
    c.close()


def _tables(c: sqlite3.Connection) -> set[str]:
    return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def test_core_tables_exist(conn: sqlite3.Connection):
    assert {
        "meta",
        "files",
        "chunks",
        "chunk_vectors",
        "edges",
        "symbols",
        "imports",
        "traces",
        "feedback",
        "fts_chunks",
    } <= _tables(conn)


def test_apply_is_idempotent(conn: sqlite3.Connection):
    before = _tables(conn)
    apply_schema(conn)
    apply_schema(conn)
    assert _tables(conn) == before
    assert schema_version(conn) == SCHEMA_VERSION


def test_sparse_works_before_any_embedder_exists(conn: sqlite3.Connection):
    """Cold start is sparse-only (decision 18), so the vec table must not be required."""
    assert dense_config(conn) is None
    conn.execute(
        "INSERT INTO fts_chunks(content, path, symbol, ident, chunk_id) VALUES(?,?,?,?,?)",
        ("public void RotateRefreshToken() {}", "src/JwtService.cs", "RotateRefreshToken",
         "rotate refresh token", 1),
    )
    hits = conn.execute(
        "SELECT chunk_id FROM fts_chunks WHERE fts_chunks MATCH 'refresh'"
    ).fetchall()
    assert [h[0] for h in hits] == [1], "identifier splitting makes this match"


def test_chunk_cascade_on_file_delete(conn: sqlite3.Connection):
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO files(path, content_hash, lang, size_bytes, mtime, indexed_at) "
        "VALUES('a.cs','h','csharp',1,0,0)"
    )
    conn.execute(
        "INSERT INTO chunks(id, path, symbol, kind, start_line, end_line, token_count) "
        "VALUES(1,'a.cs','X','class',1,2,3)"
    )
    conn.execute("DELETE FROM files WHERE path='a.cs'")
    assert conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0


@needs_vec
def test_vec_table_round_trips_int8(tmp_path: Path):
    c = connect(database=tmp_path / "index.db")
    try:
        ensure_vec_table(c, embedder_id="test/model", dim=DIM)
        assert dense_config(c) == ("test/model", DIM)

        payload = bytes(range(256)) * (DIM // 256)
        assert len(payload) == DIM, "int8 vector is one byte per dimension"
        # A bare BLOB is read as float32; int8 must be declared explicitly on both sides.
        c.execute(
            "INSERT INTO vec_chunks(chunk_id, embedding) VALUES(?, vec_int8(?))", (1, payload)
        )
        hits = c.execute(
            "SELECT chunk_id FROM vec_chunks "
            "WHERE embedding MATCH vec_int8(?) AND k = 1 ORDER BY distance",
            (payload,),
        ).fetchall()
        assert [h[0] for h in hits] == [1]
    finally:
        c.close()


@needs_vec
def test_swapping_embedder_is_refused(tmp_path: Path):
    c = connect(database=tmp_path / "index.db")
    try:
        ensure_vec_table(c, embedder_id="model/a", dim=DIM)
        with pytest.raises(EmbedderMismatch, match="reindex"):
            ensure_vec_table(c, embedder_id="model/b", dim=768)
    finally:
        c.close()


@needs_vec
def test_reset_dense_allows_a_new_embedder(tmp_path: Path):
    c = connect(database=tmp_path / "index.db")
    try:
        ensure_vec_table(c, embedder_id="model/a", dim=DIM)
        c.execute(
            "INSERT INTO files(path, content_hash, lang, size_bytes, mtime, indexed_at, "
            "dense_ready) VALUES('a.cs','h','csharp',1,0,0,1)"
        )
        reset_dense(c)
        assert dense_config(c) is None
        assert c.execute("SELECT dense_ready FROM files").fetchone()[0] == 0
        ensure_vec_table(c, embedder_id="model/b", dim=768)
        assert dense_config(c) == ("model/b", 768)
    finally:
        c.close()


def test_connect_creates_index_dir(tmp_path: Path):
    db = tmp_path / "repo" / ".retrieval" / "index.db"
    connect(database=db).close()
    assert db.exists()
