"""Generic tree-sitter chunking, driven by a per-language ChunkRules table.

A type produces a *header* chunk covering its declaration and fields up to its first member, and
each member produces its own chunk. Members are never duplicated inside the type header, so a
file's chunks partition it rather than overlapping.

Files with no recognised declarations (top-level statements, scripts) fall back to fixed line
windows, so no source file is ever silently unindexed.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import PurePosixPath
from typing import Any

from ..types import Chunk
from .base import ChunkRules

FALLBACK_WINDOW_LINES = 400
FALLBACK_KIND = "file"


@lru_cache(maxsize=16)
def get_parser(lang: str) -> Any:
    from tree_sitter_language_pack import get_parser as _get

    return _get(lang)


def parse(lang: str, src: str) -> Any:
    return get_parser(lang).parse(src.encode("utf-8"))


def node_name(node: Any) -> str | None:
    field = node.child_by_field_name("name")
    if field is not None:
        return field.text.decode("utf-8", "replace")
    for child in node.named_children:
        if child.type == "identifier":
            return child.text.decode("utf-8", "replace")
    return None


def _lines(src: str) -> list[str]:
    return src.splitlines()


def _slice(lines: list[str], start: int, end: int) -> str:
    return "\n".join(lines[start - 1 : end])


def chunk_tree(lang: str, path: str, src: str, rules: ChunkRules) -> list[Chunk]:
    """Split a source file into symbol-level chunks (decision 14)."""
    if not src.strip():
        return []
    lines = _lines(src)
    chunks: list[Chunk] = []
    root = parse(lang, src).root_node

    def emit(node: Any, kind: str, qualname: str, start: int, end: int) -> None:
        if end < start:
            return
        content = _slice(lines, start, end)
        if content.strip():
            chunks.append(
                Chunk(
                    path=path,
                    symbol=qualname,
                    kind=kind,
                    start_line=start,
                    end_line=end,
                    content=content,
                )
            )

    def visit(node: Any, prefix: str) -> None:
        for child in node.named_children:
            kind = child.type
            if kind in rules.container_nodes:
                visit(child, prefix)
            elif kind in rules.type_nodes:
                name = node_name(child) or "<anonymous>"
                qualname = f"{prefix}{name}"
                body = next(
                    (c for c in child.named_children if c.type in rules.body_nodes),
                    None,
                )
                members = (
                    [c for c in body.named_children if c.type in rules.member_nodes]
                    if body is not None
                    else []
                )
                header_end = (
                    members[0].start_point[0] if members else child.end_point[0] + 1
                )
                emit(child, kind, qualname, child.start_point[0] + 1, header_end)
                if body is not None:
                    visit(body, f"{qualname}.")
            elif kind in rules.member_nodes:
                name = node_name(child) or "<anonymous>"
                emit(
                    child,
                    kind,
                    f"{prefix}{name}",
                    child.start_point[0] + 1,
                    child.end_point[0] + 1,
                )

    visit(root, "")
    if chunks:
        return chunks
    return fallback_chunks(path, src)


def fallback_chunks(path: str, src: str) -> list[Chunk]:
    """Fixed line windows, for files the grammar yields no declarations for.

    The symbol is the file's stem, never its full path. Putting the path here duplicates it into
    the FTS `symbol` column, which is weighted 3.0 on top of the `path` column's 2.0 — a silent
    2.5x boost for every file without a real symbol, which is every doc, script and config file.
    Measured effect before the fix: markdown took 117 of 395 top-5 slots while only 61 were ever
    needed.
    """
    lines = _lines(src)
    if not lines:
        return []
    stem = PurePosixPath(path).stem
    out: list[Chunk] = []
    for start in range(0, len(lines), FALLBACK_WINDOW_LINES):
        end = min(start + FALLBACK_WINDOW_LINES, len(lines))
        content = "\n".join(lines[start:end])
        if not content.strip():
            continue
        suffix = f":{start + 1}" if len(lines) > FALLBACK_WINDOW_LINES else ""
        out.append(
            Chunk(
                path=path,
                symbol=f"{stem}{suffix}",
                kind=FALLBACK_KIND,
                start_line=start + 1,
                end_line=end,
                content=content,
            )
        )
    return out
