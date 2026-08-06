"""Adapter for languages without a resolver yet (decision 35 build order).

Chunks by fixed line windows and contributes no symbols or edges. This keeps a polyglot repo
fully indexed for sparse retrieval instead of silently dropping every file the current milestone
has not reached, at the cost of weaker ranking for those languages.
"""

from __future__ import annotations

from ..types import Chunk, ImportRef, Symbol
from .base import SymbolTable
from .treesitter import fallback_chunks


class FallbackAdapter:
    lang = "fallback"
    exts = frozenset()

    def chunk(self, path: str, src: str) -> list[Chunk]:
        return fallback_chunks(path, src)

    def symbols(self, path: str, src: str) -> list[Symbol]:
        return []

    def import_refs(self, path: str, src: str) -> list[ImportRef]:
        return []

    def resolve(self, ref: ImportRef, table: SymbolTable) -> list[str]:
        return []
