"""SQLite connections with the sqlite-vec extension loaded.

Extension loading is not universally available (some distro and Nix Python builds omit it), so
``is_vec_available`` lets callers degrade to sparse-only rather than crash. Under decision 18 a
missing dense index is already a supported state.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .. import paths
from .schema import apply_schema

_PRAGMAS = (
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA foreign_keys = ON",
    "PRAGMA busy_timeout = 5000",
    "PRAGMA temp_store = MEMORY",
)

_vec_available: bool | None = None


def is_vec_available() -> bool:
    """Whether sqlite-vec can be loaded in this interpreter. Probed once, then cached."""
    global _vec_available
    if _vec_available is None:
        probe = sqlite3.connect(":memory:")
        try:
            _load_vec(probe)
            _vec_available = True
        except Exception:
            _vec_available = False
        finally:
            probe.close()
    return _vec_available


def _load_vec(conn: sqlite3.Connection) -> None:
    import sqlite_vec

    conn.enable_load_extension(True)
    try:
        sqlite_vec.load(conn)
    finally:
        conn.enable_load_extension(False)


def connect(
    repo_root: Path | str | None = None,
    *,
    database: Path | str | None = None,
    create: bool = True,
) -> sqlite3.Connection:
    """Open the index database for a repo (or an explicit path), schema applied.

    Pass ``database=":memory:"`` for tests.
    """
    if database is None:
        if repo_root is None:
            raise ValueError("connect() needs either repo_root or database")
        database = paths.db_path(Path(repo_root))
    if isinstance(database, Path):
        if not create and not database.exists():
            raise FileNotFoundError(database)
        database.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(database), isolation_level=None)
    conn.row_factory = sqlite3.Row
    for pragma in _PRAGMAS:
        conn.execute(pragma)

    if is_vec_available():
        _load_vec(conn)
    apply_schema(conn)
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Explicit transaction. Connections are autocommit, so ``with conn`` would be a no-op."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")
