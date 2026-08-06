"""Print the tree-sitter node types for a file. Used to pin grammar node names, not shipped logic.

    uv run python scripts/probe_grammar.py csharp tests/fixtures/csharp/JwtService.cs
"""

from __future__ import annotations

import sys
from pathlib import Path

from tree_sitter_language_pack import get_parser


def main() -> int:
    lang, target = sys.argv[1], Path(sys.argv[2])
    tree = get_parser(lang).parse(target.read_bytes())

    def walk(node, depth: int = 0) -> None:
        name_node = node.child_by_field_name("name")
        label = f" :: {name_node.text.decode()}" if name_node is not None else ""
        span = f"[{node.start_point[0] + 1}-{node.end_point[0] + 1}]"
        print(f"{'  ' * depth}{node.type}{label}  {span}")
        if depth < 4:
            for child in node.named_children:
                walk(child, depth + 1)

    walk(tree.root_node)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
