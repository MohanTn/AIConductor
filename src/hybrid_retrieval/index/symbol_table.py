"""Symbol table backed by the index database.

Built fresh per index pass; the per-name cache is only valid for as long as the symbols table is
not being mutated underneath it.
"""

from __future__ import annotations

import sqlite3

from ..lang import NAMESPACE_KIND


class DbSymbolTable:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._cache: dict[tuple[str, str], list[str]] = {}
        self._paths: set[str] | None = None
        self._by_dir: dict[str, list[str]] | None = None

    def _load_paths(self) -> None:
        if self._paths is not None:
            return
        self._paths = {row[0] for row in self._conn.execute("SELECT path FROM files")}
        self._by_dir = {}
        for path in self._paths:
            directory, _, _ = path.rpartition("/")
            self._by_dir.setdefault(directory, []).append(path)

    def has_path(self, path: str) -> bool:
        self._load_paths()
        return path in self._paths

    def paths_in_dir(self, directory: str) -> list[str]:
        self._load_paths()
        return list((self._by_dir or {}).get(directory.rstrip("/"), ()))

    def paths_declaring(self, name: str, kind: str) -> list[str]:
        key = (name, kind)
        cached = self._cache.get(key)
        if cached is None:
            if kind == NAMESPACE_KIND:
                sql = "SELECT path FROM symbols WHERE name = ? AND kind = 'namespace'"
                params: tuple = (name,)
            elif kind == "type":
                sql = "SELECT path FROM symbols WHERE name = ? AND kind != 'namespace'"
                params = (name,)
            else:
                sql = "SELECT path FROM symbols WHERE name = ? AND kind = ?"
                params = (name, kind)
            cached = [row[0] for row in self._conn.execute(sql, params)]
            self._cache[key] = cached
        return list(cached)

    def invalidate(self) -> None:
        self._cache.clear()
        self._paths = None
        self._by_dir = None
