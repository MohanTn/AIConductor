"""Core value types shared across the pipeline.

All ``path`` fields are repo-relative POSIX strings. Absolute paths never enter the database.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FileRecord:
    """A tracked file as of the last index pass."""

    path: str
    content_hash: str
    lang: str
    size_bytes: int
    mtime: float


@dataclass(frozen=True, slots=True)
class Chunk:
    """A symbol-level unit of retrieval. Line numbers are 1-based inclusive."""

    path: str
    symbol: str
    kind: str
    start_line: int
    end_line: int
    content: str


@dataclass(frozen=True, slots=True)
class Symbol:
    """A declaration, used to resolve imports back to the file that defines them."""

    name: str
    path: str
    kind: str


@dataclass(frozen=True, slots=True)
class ImportRef:
    """A raw, unresolved dependency reference found in a source file."""

    path: str
    target: str
    kind: str


@dataclass(frozen=True, slots=True)
class Candidate:
    """A file under consideration, carrying whatever scores have been computed so far."""

    path: str
    dense_score: float = 0.0
    dense_rank: int | None = None
    sparse_score: float = 0.0
    sparse_rank: int | None = None
    rrf_score: float = 0.0
    ast_hops: int | None = None
    model_score: float = 0.0
    n_matching_chunks: int = 0
