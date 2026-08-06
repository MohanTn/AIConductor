from __future__ import annotations

from pathlib import Path

import pytest

from hybrid_retrieval.lang import InMemorySymbolTable, adapter_for
from hybrid_retrieval.lang.csharp import CSharpAdapter, _using_target
from hybrid_retrieval.types import ImportRef

FIXTURES = Path(__file__).parent / "fixtures" / "csharp"


@pytest.fixture
def adapter() -> CSharpAdapter:
    return CSharpAdapter()


def _read(name: str) -> str:
    return (FIXTURES / name).read_text()


# -- chunking ---------------------------------------------------------------


def test_file_scoped_namespace_chunks(adapter: CSharpAdapter):
    chunks = adapter.chunk("JwtService.cs", _read("JwtService.cs"))
    symbols = [c.symbol for c in chunks]
    assert "IJwtService" in symbols
    assert "IJwtService.Issue" in symbols
    assert "JwtService" in symbols
    assert "JwtService.JwtService" in symbols, "constructor is a chunk"
    assert "JwtService.Issue" in symbols
    assert "JwtService.Secret" in symbols
    assert "JwtService.Token" in symbols, "nested type is chunked"


def test_block_namespace_types_are_found(adapter: CSharpAdapter):
    """Block namespaces nest types inside a declaration_list; a naive walker misses them."""
    chunks = adapter.chunk("AuthController.cs", _read("AuthController.cs"))
    symbols = [c.symbol for c in chunks]
    assert "AuthController" in symbols
    assert "AuthController.Refresh" in symbols
    assert "Grant" in symbols


def test_type_header_holds_fields_but_not_member_bodies(adapter: CSharpAdapter):
    chunks = {c.symbol: c for c in adapter.chunk("JwtService.cs", _read("JwtService.cs"))}
    header = chunks["JwtService"]
    assert "class JwtService : IJwtService" in header.content
    assert "_secret;" in header.content, "fields belong to the type header"
    assert "public string Issue" not in header.content, "members are separate chunks"


def test_chunks_do_not_overlap(adapter: CSharpAdapter):
    for name in ("JwtService.cs", "AuthController.cs"):
        chunks = sorted(adapter.chunk(name, _read(name)), key=lambda c: c.start_line)
        for earlier, later in zip(chunks, chunks[1:], strict=False):
            assert earlier.end_line < later.start_line, f"{name}: {earlier} overlaps {later}"


def test_line_ranges_match_source(adapter: CSharpAdapter):
    src = _read("JwtService.cs")
    lines = src.splitlines()
    for chunk in adapter.chunk("JwtService.cs", src):
        assert chunk.content == "\n".join(lines[chunk.start_line - 1 : chunk.end_line])


def test_file_without_declarations_falls_back_to_windows(adapter: CSharpAdapter):
    chunks = adapter.chunk("src/Program.cs", 'var app = 1;\nConsole.WriteLine("hi");\n')
    assert len(chunks) == 1
    assert chunks[0].kind == "file"


def test_fallback_symbol_is_the_stem_not_the_path(adapter: CSharpAdapter):
    """The FTS symbol column is weighted above path; duplicating the path there double-counts it."""
    (chunk,) = adapter.chunk("docs/deep/Program.cs", "var app = 1;\n")
    assert chunk.symbol == "Program"
    assert "/" not in chunk.symbol


def test_empty_file_yields_nothing(adapter: CSharpAdapter):
    assert adapter.chunk("Empty.cs", "   \n\n") == []


# -- symbols ----------------------------------------------------------------


def test_symbols_include_namespace_and_types(adapter: CSharpAdapter):
    symbols = adapter.symbols("JwtService.cs", _read("JwtService.cs"))
    assert ("Api.Auth", "namespace") in {(s.name, s.kind) for s in symbols}
    assert ("JwtService", "class") in {(s.name, s.kind) for s in symbols}
    assert ("IJwtService", "interface") in {(s.name, s.kind) for s in symbols}


def test_symbols_in_block_namespace(adapter: CSharpAdapter):
    symbols = {(s.name, s.kind) for s in adapter.symbols("A.cs", _read("AuthController.cs"))}
    assert ("Api.Controllers", "namespace") in symbols
    assert ("AuthController", "class") in symbols
    assert ("Grant", "enum") in symbols


# -- imports ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("directive", "expected"),
    [
        ("using System;", "System"),
        ("using System.Text.Json;", "System.Text.Json"),
        ("using static System.Math;", "System.Math"),
        ("global using System.Linq;", "System.Linq"),
        ("using Alias = System.Text.StringBuilder;", "System.Text.StringBuilder"),
        ("  using   Api.Auth ;  ", "Api.Auth"),
        ("using (var x = y) {", None),
        ("using;", None),
    ],
)
def test_using_target_parsing(directive: str, expected: str | None):
    assert _using_target(directive) == expected


def test_import_refs_from_fixture(adapter: CSharpAdapter):
    targets = {r.target for r in adapter.import_refs("J.cs", _read("JwtService.cs"))}
    assert targets == {"System", "System.Math", "System.Text.StringBuilder", "System.Linq"}


def test_import_refs_inside_block_namespace(adapter: CSharpAdapter):
    src = "namespace A\n{\n    using B.C;\n    public class X { }\n}\n"
    assert [r.target for r in adapter.import_refs("X.cs", src)] == ["B.C"]


def test_import_refs_deduplicated(adapter: CSharpAdapter):
    src = "using A.B;\nusing A.B;\nnamespace N;\n"
    assert len(adapter.import_refs("X.cs", src)) == 1


# -- resolution -------------------------------------------------------------


def test_resolve_namespace_to_declaring_files(adapter: CSharpAdapter):
    table = InMemorySymbolTable()
    for path in ("src/JwtService.cs", "src/JwtOptions.cs"):
        table.add(_symbol("Api.Auth", path, "namespace"))
    ref = ImportRef(path="src/AuthController.cs", target="Api.Auth", kind="using")
    assert sorted(adapter.resolve(ref, table)) == ["src/JwtOptions.cs", "src/JwtService.cs"]


def test_resolve_ignores_self(adapter: CSharpAdapter):
    table = InMemorySymbolTable([_symbol("Api.Auth", "src/A.cs", "namespace")])
    ref = ImportRef(path="src/A.cs", target="Api.Auth", kind="using")
    assert adapter.resolve(ref, table) == []


def test_resolve_external_namespace_yields_nothing(adapter: CSharpAdapter):
    table = InMemorySymbolTable([_symbol("Api.Auth", "src/A.cs", "namespace")])
    ref = ImportRef(path="src/B.cs", target="System.Text.Json", kind="using")
    assert adapter.resolve(ref, table) == []


def test_resolve_using_static_type(adapter: CSharpAdapter):
    """`using static Api.Auth.TokenMath` names a type, not a namespace."""
    table = InMemorySymbolTable(
        [
            _symbol("Api.Auth", "src/TokenMath.cs", "namespace"),
            _symbol("TokenMath", "src/TokenMath.cs", "class"),
            _symbol("TokenMath", "other/TokenMath.cs", "class"),
        ]
    )
    ref = ImportRef(path="src/B.cs", target="Api.Auth.TokenMath", kind="using")
    assert adapter.resolve(ref, table) == ["src/TokenMath.cs"], "namespace must match too"


def test_registry_returns_csharp_adapter():
    assert adapter_for("csharp").lang == "csharp"
    assert adapter_for("markdown").lang == "fallback", "languages with no adapter degrade"


def _symbol(name: str, path: str, kind: str):
    from hybrid_retrieval.types import Symbol

    return Symbol(name=name, path=path, kind=kind)
