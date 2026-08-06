"""Incremental indexer.

Freshness is decided by working-tree content hash (decision 16), so the agent's own uncommitted
edits are visible to retrieval. Dense vectors are not written here: files land with
``dense_ready = 0`` and the embedding pass fills them in behind the request path (decision 18).

``paths`` restricts the pass to a known-changed set, which is what the watcher supplies. Without
it every file is hashed, which is the correct but slower full reconcile.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from ..config import Config
from ..db import connect, transaction
from ..lang import adapter_for, estimate_tokens
from ..text import identifier_text
from ..types import FileRecord
from .edges import rebuild_edges
from .hashing import hash_bytes
from .walker import classify_lang, discover

ProgressFn = Callable[[int, int], None]


@dataclass(frozen=True, slots=True)
class IndexStats:
    added: int = 0
    updated: int = 0
    removed: int = 0
    unchanged: int = 0
    chunks: int = 0
    edges: int = 0
    duration_ms: float = 0.0

    @property
    def touched(self) -> int:
        return self.added + self.updated + self.removed

    def __str__(self) -> str:
        return (
            f"+{self.added} ~{self.updated} -{self.removed} ={self.unchanged} "
            f"({self.chunks} chunks, {self.edges} edges, {self.duration_ms:.0f}ms)"
        )


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _scan(repo_root: Path, cfg: Config, paths: Iterable[str] | None) -> dict[str, FileRecord]:
    if paths is None:
        return {r.path: r for r in discover(repo_root, max_file_bytes=cfg.index.max_file_bytes)}

    out: dict[str, FileRecord] = {}
    for rel in paths:
        lang = classify_lang(rel)
        if lang is None:
            continue
        absolute = repo_root / rel
        try:
            stat = absolute.stat()
            data = absolute.read_bytes()
        except OSError:
            continue  # deleted or unreadable; handled as a removal by the caller
        if stat.st_size > cfg.index.max_file_bytes or b"\0" in data[:8192]:
            continue
        out[rel] = FileRecord(
            path=rel,
            content_hash=hash_bytes(data),
            lang=lang,
            size_bytes=stat.st_size,
            mtime=stat.st_mtime,
        )
    return out


def _purge(conn: sqlite3.Connection, path: str, *, drop_file_row: bool) -> None:
    conn.execute("DELETE FROM fts_chunks WHERE path = ?", (path,))
    conn.execute("DELETE FROM chunks WHERE path = ?", (path,))
    conn.execute("DELETE FROM symbols WHERE path = ?", (path,))
    conn.execute("DELETE FROM imports WHERE path = ?", (path,))
    conn.execute("DELETE FROM edges WHERE src = ? OR dst = ?", (path, path))
    if drop_file_row:
        conn.execute("DELETE FROM files WHERE path = ?", (path,))


def _ingest(conn: sqlite3.Connection, repo_root: Path, record: FileRecord, now: float) -> int:
    src = _read_text(repo_root / record.path)
    if src is None:
        return 0
    adapter = adapter_for(record.lang)

    conn.execute(
        "INSERT INTO files(path, content_hash, lang, size_bytes, mtime, indexed_at, dense_ready) "
        "VALUES(?,?,?,?,?,?,0) "
        "ON CONFLICT(path) DO UPDATE SET content_hash=excluded.content_hash, "
        "lang=excluded.lang, size_bytes=excluded.size_bytes, mtime=excluded.mtime, "
        "indexed_at=excluded.indexed_at, dense_ready=0",
        (
            record.path,
            record.content_hash,
            record.lang,
            record.size_bytes,
            record.mtime,
            now,
        ),
    )

    chunks = adapter.chunk(record.path, src)
    for chunk in chunks:
        cursor = conn.execute(
            "INSERT INTO chunks(path, symbol, kind, start_line, end_line, token_count) "
            "VALUES(?,?,?,?,?,?)",
            (
                chunk.path,
                chunk.symbol,
                chunk.kind,
                chunk.start_line,
                chunk.end_line,
                estimate_tokens(chunk.content),
            ),
        )
        conn.execute(
            "INSERT INTO fts_chunks(content, path, symbol, ident, chunk_id) VALUES(?,?,?,?,?)",
            (
                chunk.content,
                chunk.path,
                chunk.symbol,
                identifier_text(chunk.content + " " + chunk.symbol),
                cursor.lastrowid,
            ),
        )

    symbols = adapter.symbols(record.path, src)
    if symbols:
        conn.executemany(
            "INSERT INTO symbols(name, path, kind) VALUES(?,?,?)",
            [(s.name, s.path, s.kind) for s in symbols],
        )

    refs = adapter.import_refs(record.path, src)
    if refs:
        conn.executemany(
            "INSERT OR IGNORE INTO imports(path, target, kind) VALUES(?,?,?)",
            [(r.path, r.target, r.kind) for r in refs],
        )
    return len(chunks)


def index_repo(
    repo_root: Path | str,
    *,
    conn: sqlite3.Connection | None = None,
    cfg: Config | None = None,
    paths: Iterable[str] | None = None,
    progress: ProgressFn | None = None,
) -> IndexStats:
    """Reconcile the index with the working tree. Idempotent and safe to interrupt."""
    started = time.perf_counter()
    repo_root = Path(repo_root)
    cfg = cfg or Config.load(repo_root)
    owns_conn = conn is None
    conn = conn or connect(repo_root)

    try:
        scoped = list(paths) if paths is not None else None
        found = _scan(repo_root, cfg, scoped)

        if scoped is None:
            known = {row[0]: row[1] for row in conn.execute("SELECT path, content_hash FROM files")}
        else:
            known = {}
            for batch in (scoped[i : i + 500] for i in range(0, len(scoped), 500)):
                placeholders = ",".join("?" * len(batch))
                known.update(
                    (row[0], row[1])
                    for row in conn.execute(
                        f"SELECT path, content_hash FROM files WHERE path IN ({placeholders})",
                        batch,
                    )
                )

        added = sorted(set(found) - set(known))
        removed = sorted(set(known) - set(found))
        updated = sorted(p for p in found if p in known and found[p].content_hash != known[p])
        unchanged = len(found) - len(added) - len(updated)

        if not (added or removed or updated):
            return IndexStats(
                unchanged=unchanged, duration_ms=(time.perf_counter() - started) * 1000
            )

        pre_change = set(removed) | set(updated)
        seed_namespaces: set[str] = set()
        if pre_change:
            for batch in (
                sorted(pre_change)[i : i + 500] for i in range(0, len(pre_change), 500)
            ):
                placeholders = ",".join("?" * len(batch))
                seed_namespaces.update(
                    row[0]
                    for row in conn.execute(
                        "SELECT DISTINCT name FROM symbols "
                        f"WHERE kind = 'namespace' AND path IN ({placeholders})",
                        batch,
                    )
                )

        now = time.time()
        chunk_count = 0
        work = added + updated
        with transaction(conn):
            for path in removed:
                _purge(conn, path, drop_file_row=True)
            for done, path in enumerate(work, start=1):
                _purge(conn, path, drop_file_row=False)
                chunk_count += _ingest(conn, repo_root, found[path], now)
                if progress is not None:
                    progress(done, len(work))

            edges = rebuild_edges(
                conn,
                paths=set(added) | set(updated) | set(removed),
                seed_namespaces=seed_namespaces,
            )

        return IndexStats(
            added=len(added),
            updated=len(updated),
            removed=len(removed),
            unchanged=unchanged,
            chunks=chunk_count,
            edges=edges,
            duration_ms=(time.perf_counter() - started) * 1000,
        )
    finally:
        if owns_conn:
            conn.close()
