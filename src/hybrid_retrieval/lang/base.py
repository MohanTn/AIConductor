"""Language adapter contract (docs/SPEC.md section 5.4).

Chunking generalises across languages; import resolution does not. Everything an adapter needs
that is language-independent lives here, so a new language is a ChunkRules table plus a resolver.

Deviation from the spec text: ``resolve`` returns repo-relative ``str`` paths rather than
``Path``, matching the rest of the codebase. Absolute paths never enter the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from ..types import Chunk, ImportRef, Symbol

NAMESPACE_KIND = "namespace"


def estimate_tokens(text: str) -> int:
    """Cheap token estimate. Used for budgeting and reporting, never for model input."""
    return max(1, len(text) // 4)


@dataclass(frozen=True, slots=True)
class ChunkRules:
    """Which tree-sitter node types mean what, for the generic declaration chunker."""

    container_nodes: frozenset[str]  # descended through, never chunked (namespaces)
    type_nodes: frozenset[str]  # chunked as a header, then recursed into
    member_nodes: frozenset[str]  # chunked whole
    body_nodes: frozenset[str]  # the node holding a type's members


class SymbolTable(Protocol):
    """Index lookups an import resolver needs.

    C# resolves through declared names, because namespaces do not map to paths. TypeScript, Python
    and Go resolve through the filesystem instead, so the table exposes both.
    """

    def paths_declaring(self, name: str, kind: str) -> list[str]:
        """``kind`` is 'namespace', 'type', or a concrete type kind such as 'class'."""
        ...

    def has_path(self, path: str) -> bool:
        """Whether this repo-relative path is indexed."""
        ...

    def paths_in_dir(self, directory: str) -> list[str]:
        """Indexed files directly inside a directory, for package-style imports."""
        ...


class InMemorySymbolTable:
    """Symbol table over a list of Symbols. Used by tests and by one-shot resolution."""

    def __init__(
        self, symbols: list[Symbol] | None = None, paths: set[str] | None = None
    ) -> None:
        self._by_key: dict[tuple[str, str], list[str]] = {}
        self._paths: set[str] = set(paths or ())
        for symbol in symbols or []:
            self.add(symbol)
            self._paths.add(symbol.path)

    def has_path(self, path: str) -> bool:
        return path in self._paths

    def paths_in_dir(self, directory: str) -> list[str]:
        prefix = f"{directory}/" if directory else ""
        return [p for p in self._paths if p.startswith(prefix) and "/" not in p[len(prefix) :]]

    def add(self, symbol: Symbol) -> None:
        for key in {(symbol.name, symbol.kind), (symbol.name, self._group(symbol.kind))}:
            bucket = self._by_key.setdefault(key, [])
            if symbol.path not in bucket:
                bucket.append(symbol.path)

    @staticmethod
    def _group(kind: str) -> str:
        return NAMESPACE_KIND if kind == NAMESPACE_KIND else "type"

    def paths_declaring(self, name: str, kind: str) -> list[str]:
        return list(self._by_key.get((name, kind), ()))


@runtime_checkable
class LanguageAdapter(Protocol):
    lang: str
    exts: frozenset[str]

    def chunk(self, path: str, src: str) -> list[Chunk]: ...

    def symbols(self, path: str, src: str) -> list[Symbol]: ...

    def import_refs(self, path: str, src: str) -> list[ImportRef]: ...

    def resolve(self, ref: ImportRef, table: SymbolTable) -> list[str]: ...
