"""Dense embedding pass, run behind the request path (decision 18).

The indexer marks touched files ``dense_ready = 0``; this fills them in. Progress is committed per
file batch so an interrupted run keeps everything it already embedded, which matters on a repo
that takes minutes.
"""

from __future__ import annotations

import contextlib
import fcntl
import logging
import sqlite3
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

from .. import paths as app_paths
from ..db import connect, ensure_vec_table, transaction
from .quantize import to_float32, to_int8

log = logging.getLogger(__name__)

ProgressFn = Callable[[int, int], None]


@contextlib.contextmanager
def _embed_lock(repo_root: Path) -> Iterator[bool]:
    """Advisory cross-process lock.

    The daemon backfills continuously while `hybrid-retrieval embed` may be run by hand against
    the same index. Without this they duplicate every forward pass and fight over writes, which on
    a GPU this size is the difference between a 30 minute index and a 60 minute one.
    """
    lock_dir = app_paths.index_dir(repo_root)
    lock_dir.mkdir(parents=True, exist_ok=True)
    with open(lock_dir / "embed.lock", "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


@dataclass(frozen=True, slots=True)
class EmbedStats:
    files: int = 0
    chunks: int = 0
    duration_ms: float = 0.0

    def __str__(self) -> str:
        return f"{self.files} files, {self.chunks} chunks embedded in {self.duration_ms:.0f}ms"


def pending_files(conn: sqlite3.Connection, limit: int | None = None) -> list[str]:
    sql = "SELECT path FROM files WHERE dense_ready = 0 ORDER BY path"
    if limit is not None:
        sql += f" LIMIT {int(limit)}"
    return [row[0] for row in conn.execute(sql)]


def pending_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM files WHERE dense_ready = 0").fetchone()[0]


def _chunks_for(
    conn: sqlite3.Connection, path: str, *, min_tokens: int = 0
) -> list[tuple[int, str]]:
    """Embeddable chunks for a file.

    ``min_tokens`` drops trivial chunks (one-line getters, single-field declarations). They carry
    no meaning an embedding can capture, but they stay in the full-text index, so an exact
    identifier search still finds them.
    """
    return [
        (row[0], row[1])
        for row in conn.execute(
            "SELECT c.id, f.content FROM chunks c "
            "JOIN fts_chunks f ON f.chunk_id = c.id "
            "WHERE c.path = ? AND c.token_count >= ? ORDER BY c.id",
            (path, min_tokens),
        )
    ]


def embed_pending(
    repo_root: Path | str,
    embedder,
    *,
    conn: sqlite3.Connection | None = None,
    files_per_batch: int = 16,
    limit: int | None = None,
    min_chunk_tokens: int = 0,
    progress: ProgressFn | None = None,
) -> EmbedStats:
    started = time.perf_counter()
    repo_root = Path(repo_root)
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        with _embed_lock(repo_root) as acquired:
            if not acquired:
                log.debug("another process is already embedding %s", repo_root)
                return EmbedStats(duration_ms=(time.perf_counter() - started) * 1000)
            return _embed_locked(
                repo_root,
                embedder,
                conn,
                files_per_batch,
                limit,
                min_chunk_tokens,
                progress,
                started,
            )
    finally:
        if owns_conn:
            conn.close()


def _embed_locked(
    repo_root: Path,
    embedder,
    conn: sqlite3.Connection,
    files_per_batch: int,
    limit: int | None,
    min_chunk_tokens: int,
    progress: ProgressFn | None,
    started: float,
) -> EmbedStats:
    with transaction(conn):
        ensure_vec_table(conn, embedder_id=embedder.model_id, dim=embedder.dim)

    todo = pending_files(conn, limit)
    if not todo:
        return EmbedStats(duration_ms=(time.perf_counter() - started) * 1000)

    files_done = 0
    chunks_done = 0
    for start in range(0, len(todo), files_per_batch):
        batch_paths = todo[start : start + files_per_batch]
        ids: list[int] = []
        texts: list[str] = []
        for path in batch_paths:
            for chunk_id, content in _chunks_for(conn, path, min_tokens=min_chunk_tokens):
                ids.append(chunk_id)
                texts.append(content)

        vectors = embedder.encode_documents(texts) if texts else []

        with transaction(conn):
            for chunk_id, vector in zip(ids, vectors, strict=True):
                # vec0 virtual tables do not implement UPSERT, so replace explicitly.
                conn.execute("DELETE FROM vec_chunks WHERE chunk_id = ?", (chunk_id,))
                conn.execute(
                    "INSERT INTO vec_chunks(chunk_id, embedding) VALUES(?, vec_int8(?))",
                    (chunk_id, to_int8(vector)),
                )
                conn.execute(
                    "INSERT INTO chunk_vectors(chunk_id, vec) VALUES(?, ?) "
                    "ON CONFLICT(chunk_id) DO UPDATE SET vec = excluded.vec",
                    (chunk_id, to_float32(vector)),
                )
            conn.executemany(
                "UPDATE files SET dense_ready = 1 WHERE path = ?",
                [(p,) for p in batch_paths],
            )

        files_done += len(batch_paths)
        chunks_done += len(ids)
        if progress is not None:
            progress(files_done, len(todo))

    return EmbedStats(
        files=files_done,
        chunks=chunks_done,
        duration_ms=(time.perf_counter() - started) * 1000,
    )
