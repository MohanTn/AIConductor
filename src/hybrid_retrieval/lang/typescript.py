"""TypeScript and JavaScript adapter.

Structurally the opposite of C#: imports resolve through the filesystem, not through a declared
namespace table, so `resolve` walks candidate extensions rather than a symbol index.

The one shape that catches people out is `export_statement`. Every exported declaration is nested
inside one, so a chunker that only looks at top-level nodes finds nothing in a normal module. It
is a container here, exactly like a block-scoped C# namespace.

Bare specifiers (`react`, `node:crypto`) resolve to nothing on purpose: they are dependencies, not
repo files, and an edge to a package the index does not contain is noise.
"""

from __future__ import annotations

import re

from ..types import Chunk, ImportRef, Symbol
from .base import ChunkRules, SymbolTable
from .treesitter import chunk_tree, node_name, parse

LANG = "typescript"

CONTAINER_NODES = frozenset({"export_statement", "statement_block", "program"})

TYPE_NODES = frozenset(
    {
        "class_declaration",
        "abstract_class_declaration",
        "interface_declaration",
    }
)

MEMBER_NODES = frozenset(
    {
        "method_definition",
        "function_declaration",
        "generator_function_declaration",
        "public_field_definition",
        "type_alias_declaration",
        "enum_declaration",
        "lexical_declaration",
        "variable_declaration",
    }
)

BODY_NODES = frozenset({"class_body", "interface_body", "object_type"})

RULES = ChunkRules(
    container_nodes=CONTAINER_NODES,
    type_nodes=TYPE_NODES,
    member_nodes=MEMBER_NODES,
    body_nodes=BODY_NODES,
)

# Files a specifier may resolve to, in the order Node and TypeScript try them.
_EXTENSIONS = (".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs")
_INDEX_FILES = tuple(f"index{ext}" for ext in _EXTENSIONS)

_KIND_BY_NODE = {
    "class_declaration": "class",
    "abstract_class_declaration": "class",
    "interface_declaration": "interface",
    "type_alias_declaration": "type",
    "enum_declaration": "enum",
}

_BARE = re.compile(r"^[a-zA-Z@]")


def _declarator_name(node) -> str | None:
    """`const buildCacheKey = ...` keeps its name on the declarator, not the declaration."""
    for child in node.named_children:
        if child.type == "variable_declarator":
            name = child.child_by_field_name("name")
            if name is not None:
                return name.text.decode("utf-8", "replace")
    return None


class TypeScriptAdapter:
    lang = LANG
    exts = frozenset({".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"})

    def chunk(self, path: str, src: str) -> list[Chunk]:
        chunks = chunk_tree(LANG, path, src, RULES)
        # lexical declarations carry their name one level down; relabel rather than lose it.
        fixed: list[Chunk] = []
        root = parse(LANG, src).root_node if chunks else None
        names = _lexical_names(root) if root is not None else {}
        for chunk in chunks:
            if chunk.kind in {"lexical_declaration", "variable_declaration"}:
                better = names.get(chunk.start_line)
                if better:
                    chunk = Chunk(
                        path=chunk.path,
                        symbol=better,
                        kind=chunk.kind,
                        start_line=chunk.start_line,
                        end_line=chunk.end_line,
                        content=chunk.content,
                    )
            fixed.append(chunk)
        return fixed

    def symbols(self, path: str, src: str) -> list[Symbol]:
        out: list[Symbol] = []
        root = parse(LANG, src).root_node

        def visit(node) -> None:
            for child in node.named_children:
                kind = _KIND_BY_NODE.get(child.type)
                if kind:
                    name = node_name(child)
                    if name:
                        out.append(Symbol(name=name, path=path, kind=kind))
                elif child.type in {"function_declaration", "generator_function_declaration"}:
                    name = node_name(child)
                    if name:
                        out.append(Symbol(name=name, path=path, kind="function"))
                if child.type in CONTAINER_NODES or child.type in BODY_NODES:
                    visit(child)

        visit(root)
        return out

    def import_refs(self, path: str, src: str) -> list[ImportRef]:
        out: list[ImportRef] = []
        seen: set[str] = set()
        stack = [parse(LANG, src).root_node]
        while stack:
            node = stack.pop()
            if node.type in {"import_statement", "export_statement"}:
                source = node.child_by_field_name("source")
                if source is not None:
                    target = source.text.decode("utf-8", "replace").strip("\"'`")
                    if target and target not in seen:
                        seen.add(target)
                        out.append(ImportRef(path=path, target=target, kind="import"))
            stack.extend(node.named_children)
        return out

    def resolve(self, ref: ImportRef, table: SymbolTable) -> list[str]:
        target = ref.target
        if not target.startswith("."):
            return []  # a package, not a repo file
        base = _join(_dirname(ref.path), target)
        for candidate in _candidates(base):
            if table.has_path(candidate) and candidate != ref.path:
                return [candidate]
        return []


def _lexical_names(root) -> dict[int, str]:
    names: dict[int, str] = {}
    stack = [root]
    while stack:
        node = stack.pop()
        if node.type in {"lexical_declaration", "variable_declaration"}:
            name = _declarator_name(node)
            if name:
                names[node.start_point[0] + 1] = name
        stack.extend(node.named_children)
    return names


def _dirname(path: str) -> str:
    directory, _, _ = path.rpartition("/")
    return directory


def _join(base: str, relative: str) -> str:
    parts = [p for p in base.split("/") if p] if base else []
    for piece in relative.split("/"):
        if piece in ("", "."):
            continue
        if piece == "..":
            if parts:
                parts.pop()
        else:
            parts.append(piece)
    return "/".join(parts)


def _candidates(base: str) -> list[str]:
    """A specifier may name the file, the file minus extension, or a directory's index."""
    out = [base]
    stem = base
    for ext in (".js", ".jsx", ".mjs"):
        if stem.endswith(ext):  # TS source imported by its emitted JS name
            stem = stem[: -len(ext)]
            break
    out.extend(f"{stem}{ext}" for ext in _EXTENSIONS)
    out.extend(f"{base}/{index}" for index in _INDEX_FILES)
    return out
