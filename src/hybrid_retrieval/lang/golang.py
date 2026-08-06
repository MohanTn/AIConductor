"""Go adapter.

Go differs from the other three in a way that simplifies chunking and complicates resolution.

Chunking: methods are declared at file scope with a receiver, not nested inside their type, so
there is no type body to descend into. Every declaration is a flat top-level chunk.

Resolution: an import path is module-qualified ("github.com/example/api/internal/tokens"), so the
module prefix from go.mod has to be stripped before it means anything on disk. The target is then
a *directory*, and every .go file in it is a neighbour, because a Go package spans its files.
"""

from __future__ import annotations

from ..types import Chunk, ImportRef, Symbol
from .base import ChunkRules, SymbolTable
from .treesitter import chunk_tree, node_name, parse

LANG = "go"

CONTAINER_NODES = frozenset({"source_file"})
TYPE_NODES = frozenset()  # methods live outside their type, so nothing has a members body
MEMBER_NODES = frozenset(
    {
        "function_declaration",
        "method_declaration",
        "type_declaration",
        "const_declaration",
        "var_declaration",
    }
)
BODY_NODES = frozenset()

RULES = ChunkRules(
    container_nodes=CONTAINER_NODES,
    type_nodes=TYPE_NODES,
    member_nodes=MEMBER_NODES,
    body_nodes=BODY_NODES,
)

MAX_PACKAGE_FILES = 8


class GoAdapter:
    lang = LANG
    exts = frozenset({".go"})

    def chunk(self, path: str, src: str) -> list[Chunk]:
        return chunk_tree(LANG, path, src, RULES)

    def symbols(self, path: str, src: str) -> list[Symbol]:
        out: list[Symbol] = []
        root = parse(LANG, src).root_node
        for node in root.named_children:
            if node.type == "type_declaration":
                for spec in node.named_children:
                    if spec.type == "type_spec":
                        name = node_name(spec)
                        if name:
                            out.append(Symbol(name=name, path=path, kind="type"))
            elif node.type in {"function_declaration", "method_declaration"}:
                name = node_name(node)
                if name:
                    out.append(Symbol(name=name, path=path, kind="function"))
            elif node.type == "package_clause":
                for child in node.named_children:
                    if child.type == "package_identifier":
                        out.append(
                            Symbol(
                                name=child.text.decode("utf-8", "replace"),
                                path=path,
                                kind="package",
                            )
                        )
        return out

    def import_refs(self, path: str, src: str) -> list[ImportRef]:
        out: list[ImportRef] = []
        seen: set[str] = set()
        root = parse(LANG, src).root_node
        stack = [root]
        while stack:
            node = stack.pop()
            if node.type == "import_spec":
                for child in node.named_children:
                    if child.type in {"interpreted_string_literal", "raw_string_literal"}:
                        target = child.text.decode("utf-8", "replace").strip("\"'`")
                        if target and target not in seen:
                            seen.add(target)
                            out.append(ImportRef(path=path, target=target, kind="import"))
            stack.extend(node.named_children)
        return out

    def resolve(self, ref: ImportRef, table: SymbolTable) -> list[str]:
        target = ref.target
        if "/" not in target:
            return []  # stdlib: fmt, errors, strings

        # The module prefix is unknown here, so try progressively shorter suffixes of the import
        # path as directories. "github.com/x/api/internal/tokens" -> "internal/tokens" -> "tokens".
        pieces = target.split("/")
        for start in range(len(pieces)):
            directory = "/".join(pieces[start:])
            files = [
                p for p in table.paths_in_dir(directory) if p.endswith(".go") and p != ref.path
            ]
            if files:
                return sorted(files)[:MAX_PACKAGE_FILES]
        return []
