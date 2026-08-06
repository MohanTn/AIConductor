"""C# adapter — the hard resolver, built first on purpose (decision 35).

C# namespaces do not map to directories, so an import cannot be resolved by path arithmetic the
way TypeScript or Go can. Resolution goes through a repo-wide namespace declaration table.

Two edge sources matter here:
  * ``using X.Y`` -> every file declaring ``namespace X.Y``
  * same-namespace adjacency, because C# types in one namespace see each other with no using at
    all. That edge is produced by the indexer, which is the only place with a repo-wide view.
"""

from __future__ import annotations

import re

from ..types import Chunk, ImportRef, Symbol
from .base import NAMESPACE_KIND, ChunkRules, SymbolTable
from .treesitter import chunk_tree, node_name, parse

LANG = "csharp"

NAMESPACE_NODES = frozenset({"namespace_declaration", "file_scoped_namespace_declaration"})

TYPE_NODES = frozenset(
    {
        "class_declaration",
        "interface_declaration",
        "struct_declaration",
        "record_declaration",
        "record_struct_declaration",
        "enum_declaration",
    }
)

MEMBER_NODES = frozenset(
    {
        "method_declaration",
        "constructor_declaration",
        "destructor_declaration",
        "property_declaration",
        "indexer_declaration",
        "operator_declaration",
        "conversion_operator_declaration",
        "event_declaration",
        "event_field_declaration",
        "delegate_declaration",
    }
)

BODY_NODES = frozenset({"declaration_list", "enum_member_declaration_list"})

RULES = ChunkRules(
    # A block-scoped namespace holds its types inside a declaration_list, so the chunker has to
    # descend through it. Type bodies are reached via body_nodes instead, never through here.
    container_nodes=NAMESPACE_NODES | frozenset({"declaration_list"}),
    type_nodes=TYPE_NODES,
    member_nodes=MEMBER_NODES,
    body_nodes=BODY_NODES,
)

_KIND_BY_NODE = {
    "class_declaration": "class",
    "interface_declaration": "interface",
    "struct_declaration": "struct",
    "record_declaration": "record",
    "record_struct_declaration": "record",
    "enum_declaration": "enum",
}

# `global using static Foo.Bar;` / `using Alias = A.B.C;` / `using A.B;`
_USING_PREFIX = re.compile(r"^\s*(?:global\s+)?using\b\s*(?:static\b\s*|unsafe\b\s*)*")


def _using_target(text: str) -> str | None:
    """Extract the dotted name a using directive refers to."""
    body = _USING_PREFIX.sub("", text.strip()).rstrip(";").strip()
    if not body:
        return None
    if "=" in body:  # alias: take the right-hand side
        body = body.split("=", 1)[1].strip()
    if not body or not re.fullmatch(r"[A-Za-z_][\w.]*", body):
        return None  # using-declarations inside methods, unsafe pointer forms, etc.
    return body


class CSharpAdapter:
    lang = LANG
    exts = frozenset({".cs"})

    def chunk(self, path: str, src: str) -> list[Chunk]:
        return chunk_tree(LANG, path, src, RULES)

    def symbols(self, path: str, src: str) -> list[Symbol]:
        out: list[Symbol] = []
        root = parse(LANG, src).root_node

        def visit(node) -> None:
            for child in node.named_children:
                if child.type in NAMESPACE_NODES:
                    name = child.child_by_field_name("name")
                    if name is not None:
                        out.append(
                            Symbol(
                                name=name.text.decode("utf-8", "replace"),
                                path=path,
                                kind=NAMESPACE_KIND,
                            )
                        )
                    visit(child)
                elif child.type in TYPE_NODES:
                    name = node_name(child)
                    if name:
                        out.append(
                            Symbol(name=name, path=path, kind=_KIND_BY_NODE[child.type])
                        )
                    visit(child)
                elif child.type in BODY_NODES:
                    visit(child)

        visit(root)
        return out

    def import_refs(self, path: str, src: str) -> list[ImportRef]:
        """Usings are usually at file scope but are legal inside a block namespace too."""
        out: list[ImportRef] = []
        seen: set[str] = set()
        stack = [parse(LANG, src).root_node]
        while stack:
            node = stack.pop()
            if node.type == "using_directive":
                target = _using_target(node.text.decode("utf-8", "replace"))
                if target and target not in seen:
                    seen.add(target)
                    out.append(ImportRef(path=path, target=target, kind="using"))
                continue
            stack.extend(node.named_children)
        return out

    def resolve(self, ref: ImportRef, table: SymbolTable) -> list[str]:
        """Map a using target to in-repo files. External namespaces resolve to nothing."""
        paths = table.paths_declaring(ref.target, NAMESPACE_KIND)
        if paths:
            return [p for p in paths if p != ref.path]
        # `using static Some.Namespace.TypeName` — split off the type and intersect.
        if "." in ref.target:
            namespace, type_name = ref.target.rsplit(".", 1)
            in_namespace = set(table.paths_declaring(namespace, NAMESPACE_KIND))
            declaring = table.paths_declaring(type_name, "type")
            return [p for p in declaring if p in in_namespace and p != ref.path]
        return []
