"""Structural graph construction (decision 22: depth-2 import traversal boost).

Two edge kinds today, both file to file:

``using``
    A resolved import. Produced by the language adapter.

``same_namespace``
    C# types in one namespace reference each other with no import at all, so the import graph
    alone would miss the most obvious neighbours. Capped by fan-out: a namespace with hundreds of
    files is a grab-bag, not a signal, and the edge count would be quadratic.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable

from ..lang import NAMESPACE_KIND, adapter_for
from ..types import ImportRef
from .symbol_table import DbSymbolTable

SAME_NAMESPACE_FANOUT_CAP = 50


def _chunked(items: list[str], size: int = 500) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _query_set(conn: sqlite3.Connection, sql: str, values: Iterable[str]) -> set[str]:
    values = list(values)
    out: set[str] = set()
    for batch in _chunked(values):
        placeholders = ",".join("?" * len(batch))
        out.update(row[0] for row in conn.execute(sql.format(ph=placeholders), batch))
    return out


def affected_closure(
    conn: sqlite3.Connection,
    changed: set[str],
    seed_namespaces: set[str] = frozenset(),
) -> set[str]:
    """Files whose edges may differ because ``changed`` changed.

    A file's edges depend on the namespaces it imports and the namespace it declares, so the
    closure is everything that declares or imports any namespace touched by the change.
    ``seed_namespaces`` carries namespaces that only existed in the pre-change state (deleted or
    renamed declarations), which the post-change tables can no longer report.
    """
    if not changed and not seed_namespaces:
        return set()
    namespaces = set(seed_namespaces)
    namespaces |= _query_set(
        conn,
        "SELECT DISTINCT name FROM symbols WHERE kind = 'namespace' AND path IN ({ph})",
        changed,
    )
    namespaces |= _query_set(
        conn, "SELECT DISTINCT target FROM imports WHERE path IN ({ph})", changed
    )

    closure = set(changed)
    if namespaces:
        closure |= _query_set(
            conn,
            "SELECT DISTINCT path FROM symbols WHERE kind = 'namespace' AND name IN ({ph})",
            namespaces,
        )
        closure |= _query_set(
            conn, "SELECT DISTINCT path FROM imports WHERE target IN ({ph})", namespaces
        )
    return closure


def rebuild_edges(
    conn: sqlite3.Connection,
    *,
    paths: set[str] | None = None,
    seed_namespaces: set[str] = frozenset(),
) -> int:
    """Recompute outgoing edges for ``paths`` (or every indexed file when None)."""
    if paths is None:
        targets = {row[0] for row in conn.execute("SELECT path FROM files")}
        conn.execute("DELETE FROM edges")
    else:
        targets = affected_closure(conn, paths, seed_namespaces)
        if not targets:
            return 0
        for batch in _chunked(sorted(targets)):
            placeholders = ",".join("?" * len(batch))
            conn.execute(f"DELETE FROM edges WHERE src IN ({placeholders})", batch)

    langs = {
        row[0]: row[1]
        for row in conn.execute("SELECT path, lang FROM files")
        if row[0] in targets
    }
    table = DbSymbolTable(conn)
    rows: list[tuple[str, str, str]] = []

    for path, lang in langs.items():
        adapter = adapter_for(lang)
        for target, kind in conn.execute(
            "SELECT target, kind FROM imports WHERE path = ?", (path,)
        ).fetchall():
            ref = ImportRef(path=path, target=target, kind=kind)
            rows.extend((path, dst, "using") for dst in adapter.resolve(ref, table))

    rows.extend(_same_namespace_edges(conn, targets, table))

    if rows:
        conn.executemany("INSERT OR IGNORE INTO edges(src, dst, kind) VALUES(?,?,?)", rows)
    return len(rows)


def _same_namespace_edges(
    conn: sqlite3.Connection, targets: set[str], table: DbSymbolTable
) -> list[tuple[str, str, str]]:
    namespaces = _query_set(
        conn,
        "SELECT DISTINCT name FROM symbols WHERE kind = 'namespace' AND path IN ({ph})",
        sorted(targets),
    )
    rows: list[tuple[str, str, str]] = []
    for namespace in namespaces:
        members = table.paths_declaring(namespace, NAMESPACE_KIND)
        if len(members) > SAME_NAMESPACE_FANOUT_CAP:
            continue
        for src in members:
            if src not in targets:
                continue
            rows.extend((src, dst, "same_namespace") for dst in members if dst != src)
    return rows
