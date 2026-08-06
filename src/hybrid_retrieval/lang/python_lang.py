"""Python adapter.

`decorated_definition` is the shape to watch: any decorated class or function is wrapped in one,
so a chunker that only inspects top-level node types silently loses every `@dataclass`,
`@pytest.fixture` and `@property` in the repo.

Resolution handles both relative imports (`from .helper import X`, counting the leading dots) and
absolute ones (`from api.config import settings`), which are tried against the repo root and the
usual source roots. Dynamic imports are an accepted miss.
"""

from __future__ import annotations

from ..types import Chunk, ImportRef, Symbol
from .base import ChunkRules, SymbolTable
from .treesitter import chunk_tree, node_name, parse

LANG = "python"

CONTAINER_NODES = frozenset({"decorated_definition", "module"})
TYPE_NODES = frozenset({"class_definition"})
MEMBER_NODES = frozenset({"function_definition", "decorated_definition"})
BODY_NODES = frozenset({"block"})

RULES = ChunkRules(
    container_nodes=CONTAINER_NODES,
    type_nodes=TYPE_NODES,
    member_nodes=frozenset({"function_definition"}),
    body_nodes=BODY_NODES,
)

# Directories that commonly hold the importable root of a project.
SOURCE_ROOTS = ("", "src", "lib", "app")


class PythonAdapter:
    lang = LANG
    exts = frozenset({".py", ".pyi"})

    def chunk(self, path: str, src: str) -> list[Chunk]:
        return chunk_tree(LANG, path, src, RULES)

    def symbols(self, path: str, src: str) -> list[Symbol]:
        out: list[Symbol] = []
        root = parse(LANG, src).root_node

        def visit(node) -> None:
            for child in node.named_children:
                if child.type == "class_definition":
                    name = node_name(child)
                    if name:
                        out.append(Symbol(name=name, path=path, kind="class"))
                    visit(child)
                elif child.type == "function_definition":
                    name = node_name(child)
                    if name:
                        out.append(Symbol(name=name, path=path, kind="function"))
                elif child.type in CONTAINER_NODES or child.type in BODY_NODES:
                    visit(child)

        visit(root)
        return out

    def import_refs(self, path: str, src: str) -> list[ImportRef]:
        out: list[ImportRef] = []
        seen: set[str] = set()
        root = parse(LANG, src).root_node

        for node in root.named_children:
            if node.type == "import_statement":
                for child in node.named_children:
                    if child.type in {"dotted_name", "aliased_import"}:
                        target = _dotted_text(child)
                        if target and target not in seen:
                            seen.add(target)
                            out.append(ImportRef(path=path, target=target, kind="import"))
            elif node.type == "import_from_statement":
                module = node.child_by_field_name("module_name")
                if module is None:
                    continue
                target = module.text.decode("utf-8", "replace").strip()
                if target and target not in seen:
                    seen.add(target)
                    out.append(ImportRef(path=path, target=target, kind="from"))
        return out

    def resolve(self, ref: ImportRef, table: SymbolTable) -> list[str]:
        target = ref.target
        if target.startswith("."):
            base = _relative_base(ref.path, target)
            if base is None:
                return []
            return _module_files(base, table, exclude=ref.path)

        module_path = target.replace(".", "/")
        for root in SOURCE_ROOTS:
            base = f"{root}/{module_path}" if root else module_path
            found = _module_files(base, table, exclude=ref.path)
            if found:
                return found
        return []


def _dotted_text(node) -> str:
    if node.type == "aliased_import":
        inner = node.child_by_field_name("name")
        node = inner if inner is not None else node
    return node.text.decode("utf-8", "replace").strip()


def _relative_base(path: str, target: str) -> str | None:
    """`..types.token` from `api/auth/service.py` means `api/types/token`."""
    dots = len(target) - len(target.lstrip("."))
    remainder = target[dots:]
    parts = path.split("/")[:-1]  # the importing file's directory
    up = dots - 1
    if up > len(parts):
        return None
    if up:
        parts = parts[:-up]
    if remainder:
        parts.extend(remainder.split("."))
    return "/".join(parts)


def _module_files(base: str, table: SymbolTable, *, exclude: str) -> list[str]:
    for candidate in (f"{base}.py", f"{base}.pyi", f"{base}/__init__.py"):
        if table.has_path(candidate) and candidate != exclude:
            return [candidate]
    # `from package import thing` where thing is a submodule of a package directory
    siblings = [p for p in table.paths_in_dir(base) if p.endswith((".py", ".pyi"))]
    return [p for p in siblings if p != exclude][:5]
