"""SQLite schema, mirroring docs/SPEC.md section 6.

Dense and sparse indexes live in the same database so they update in one transaction
(decision 9). Vectors are stored twice on purpose: int8 in ``vec_chunks`` for the brute-force
scan, float32 in ``chunk_vectors`` for rescoring the top ``rescore_k`` (decision 10).

``vec_chunks`` deliberately avoids sqlite-vec auxiliary/metadata columns: the join to ``chunks``
costs nothing at these row counts and keeps us off version-specific syntax.

Note: sqlite-vec reads a bare BLOB parameter as float32. Every int8 read and write must wrap the
blob in ``vec_int8(?)`` or it fails with a type mismatch at runtime.
"""

from __future__ import annotations

import sqlite3

SCHEMA_VERSION = 1

# The vector table's dimension comes from whichever model is loaded, not from a constant, and is
# recorded in `meta` alongside the model id. Swapping embedders is then a detectable mismatch that
# forces a clean reindex instead of silently comparing vectors from two different models.
META_EMBEDDER_ID = "embedder_id"
META_EMBEDDING_DIM = "embedding_dim"

CORE_DDL: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS files (
        path         TEXT PRIMARY KEY,
        content_hash TEXT    NOT NULL,
        lang         TEXT    NOT NULL,
        size_bytes   INTEGER NOT NULL,
        mtime        REAL    NOT NULL,
        indexed_at   REAL    NOT NULL,
        dense_ready  INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_files_dense_ready ON files(dense_ready)",
    """
    CREATE TABLE IF NOT EXISTS chunks (
        id          INTEGER PRIMARY KEY,
        path        TEXT    NOT NULL REFERENCES files(path) ON DELETE CASCADE,
        symbol      TEXT    NOT NULL,
        kind        TEXT    NOT NULL,
        start_line  INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        token_count INTEGER NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path)",
    """
    CREATE TABLE IF NOT EXISTS chunk_vectors (
        chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
        vec      BLOB NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS edges (
        src  TEXT NOT NULL,
        dst  TEXT NOT NULL,
        kind TEXT NOT NULL,
        PRIMARY KEY (src, dst, kind)
    ) WITHOUT ROWID
    """,
    "CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst)",
    """
    CREATE TABLE IF NOT EXISTS symbols (
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)",
    "CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path)",
    """
    CREATE TABLE IF NOT EXISTS imports (
        path   TEXT NOT NULL,
        target TEXT NOT NULL,
        kind   TEXT NOT NULL,
        PRIMARY KEY (path, target, kind)
    ) WITHOUT ROWID
    """,
    "CREATE INDEX IF NOT EXISTS idx_imports_target ON imports(target)",
    """
    CREATE TABLE IF NOT EXISTS traces (
        id              INTEGER PRIMARY KEY,
        ts              REAL    NOT NULL,
        session_id      TEXT,
        prompt          TEXT    NOT NULL,
        skipped         INTEGER NOT NULL DEFAULT 0,
        skip_reason     TEXT,
        decision        TEXT,
        latency_ms      REAL,
        injected_tokens INTEGER NOT NULL DEFAULT 0,
        stages          TEXT,
        selected        TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_traces_ts ON traces(ts)",
    "CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id)",
    """
    CREATE TABLE IF NOT EXISTS feedback (
        trace_id    INTEGER PRIMARY KEY REFERENCES traces(id) ON DELETE CASCADE,
        read_paths  TEXT,
        edited_paths TEXT,
        observed_at REAL NOT NULL
    )
    """,
)

# `ident` holds the identifier-split form of the chunk (RotateRefreshToken -> rotate refresh
# token). Without it, unicode61 treats a compound identifier as one token and the query "refresh
# token" cannot match `RotateRefreshToken` at all — which is precisely the diagram's own example.
FTS_DDL = """
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
        content,
        path,
        symbol,
        ident,
        chunk_id UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
    )
"""

# bm25() weights follow column order: content, path, symbol, ident.
BM25_WEIGHTS = (1.0, 2.0, 3.0, 1.5)

def vec_ddl(dim: int) -> str:
    return f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding int8[{dim}]
        )
    """


def apply_schema(conn: sqlite3.Connection) -> None:
    """Create the core and full-text tables. Idempotent.

    The vector table is created separately by ``ensure_vec_table`` once an embedder is loaded, so
    an index is usable for sparse retrieval before any model exists (decision 18).
    """
    with conn:
        for statement in CORE_DDL:
            conn.execute(statement)
        conn.execute(FTS_DDL)
        set_meta(conn, "schema_version", str(SCHEMA_VERSION))


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def schema_version(conn: sqlite3.Connection) -> int | None:
    value = get_meta(conn, "schema_version")
    return int(value) if value else None


def dense_config(conn: sqlite3.Connection) -> tuple[str, int] | None:
    """The (embedder_id, dim) this index was built with, or None if dense is not set up."""
    embedder = get_meta(conn, META_EMBEDDER_ID)
    dim = get_meta(conn, META_EMBEDDING_DIM)
    return (embedder, int(dim)) if embedder and dim else None


class EmbedderMismatch(RuntimeError):
    """The loaded model does not match the one the index was built with."""


def ensure_vec_table(conn: sqlite3.Connection, *, embedder_id: str, dim: int) -> None:
    """Create the vector table for this embedder, or refuse if the index used a different one."""
    existing = dense_config(conn)
    if existing is not None and existing != (embedder_id, dim):
        raise EmbedderMismatch(
            f"index was built with {existing[0]} at {existing[1]} dims, "
            f"loaded model is {embedder_id} at {dim} dims; reindex with --reset-dense"
        )
    conn.execute(vec_ddl(dim))
    set_meta(conn, META_EMBEDDER_ID, embedder_id)
    set_meta(conn, META_EMBEDDING_DIM, str(dim))


def reset_dense(conn: sqlite3.Connection) -> None:
    """Drop every dense artefact so a different embedder can take over."""
    conn.execute("DROP TABLE IF EXISTS vec_chunks")
    conn.execute("DELETE FROM chunk_vectors")
    conn.execute("UPDATE files SET dense_ready = 0")
    conn.execute("DELETE FROM meta WHERE key IN (?, ?)", (META_EMBEDDER_ID, META_EMBEDDING_DIM))
