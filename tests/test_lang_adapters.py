"""TypeScript, Python and Go adapters (M5)."""

from __future__ import annotations

from pathlib import Path

import pytest

from hybrid_retrieval.lang import (
    GoAdapter,
    InMemorySymbolTable,
    PythonAdapter,
    TypeScriptAdapter,
    adapter_for,
)
from hybrid_retrieval.types import ImportRef

FIXTURES = Path(__file__).parent / "fixtures"


def _read(lang: str, name: str) -> str:
    return (FIXTURES / lang / name).read_text()


# -- typescript -------------------------------------------------------------


@pytest.fixture
def ts() -> TypeScriptAdapter:
    return TypeScriptAdapter()


def test_ts_finds_exported_declarations(ts: TypeScriptAdapter):
    """Everything exported is wrapped in export_statement; a naive walker sees nothing."""
    symbols = [c.symbol for c in ts.chunk("authService.ts", _read("typescript", "authService.ts"))]
    assert "IAuthService" in symbols
    assert "AuthService" in symbols
    assert "AuthService.refresh" in symbols
    assert "AuthService.constructor" in symbols
    assert "rotateRefreshToken" in symbols


def test_ts_names_arrow_function_constants(ts: TypeScriptAdapter):
    symbols = [c.symbol for c in ts.chunk("authService.ts", _read("typescript", "authService.ts"))]
    assert "buildCacheKey" in symbols, "const arrow functions keep their name on the declarator"


def test_ts_symbols_have_kinds(ts: TypeScriptAdapter):
    found = {(s.name, s.kind) for s in ts.symbols("a.ts", _read("typescript", "authService.ts"))}
    assert ("AuthService", "class") in found
    assert ("IAuthService", "interface") in found
    assert ("rotateRefreshToken", "function") in found


def test_ts_import_specifiers(ts: TypeScriptAdapter):
    targets = {r.target for r in ts.import_refs("a.ts", _read("typescript", "authService.ts"))}
    assert targets == {"./jwtHelper", "../types/token", "node:crypto", "./config"}


@pytest.mark.parametrize(
    ("importer", "specifier", "expected"),
    [
        ("src/auth/service.ts", "./helper", "src/auth/helper.ts"),
        ("src/auth/service.ts", "../types/token", "src/types/token.ts"),
        ("src/auth/service.ts", "./helper.js", "src/auth/helper.ts"),
        ("src/auth/service.ts", "./widgets", "src/auth/widgets/index.ts"),
    ],
)
def test_ts_resolves_relative_imports(
    ts: TypeScriptAdapter, importer: str, specifier: str, expected: str
):
    table = InMemorySymbolTable(paths={expected, importer})
    ref = ImportRef(path=importer, target=specifier, kind="import")
    assert ts.resolve(ref, table) == [expected]


def test_ts_bare_specifiers_resolve_to_nothing(ts: TypeScriptAdapter):
    table = InMemorySymbolTable(paths={"node_modules/react/index.js"})
    ref = ImportRef(path="src/app.ts", target="react", kind="import")
    assert ts.resolve(ref, table) == [], "packages are dependencies, not repo files"


def test_ts_unresolvable_relative_import_is_empty(ts: TypeScriptAdapter):
    table = InMemorySymbolTable(paths={"src/other.ts"})
    ref = ImportRef(path="src/app.ts", target="./missing", kind="import")
    assert ts.resolve(ref, table) == []


# -- python -----------------------------------------------------------------


@pytest.fixture
def py() -> PythonAdapter:
    return PythonAdapter()


def test_python_finds_decorated_definitions(py: PythonAdapter):
    """@dataclass wraps the class in decorated_definition; missing it loses every decorated node."""
    symbols = [c.symbol for c in py.chunk("auth.py", _read("python", "auth_service.py"))]
    assert "RefreshResult" in symbols
    assert "AuthService" in symbols
    assert "AuthService.refresh" in symbols
    assert "AuthService.issuer" in symbols, "decorated @property method"
    assert "rotate_refresh_token" in symbols


def test_python_symbols_have_kinds(py: PythonAdapter):
    found = {(s.name, s.kind) for s in py.symbols("a.py", _read("python", "auth_service.py"))}
    assert ("AuthService", "class") in found
    assert ("rotate_refresh_token", "function") in found


def test_python_import_targets(py: PythonAdapter):
    targets = {r.target for r in py.import_refs("a.py", _read("python", "auth_service.py"))}
    assert "hashlib" in targets
    assert ".jwt_helper" in targets
    assert "..types.token" in targets
    assert "api.config" in targets


@pytest.mark.parametrize(
    ("importer", "target", "expected"),
    [
        ("api/auth/service.py", ".jwt_helper", "api/auth/jwt_helper.py"),
        ("api/auth/service.py", "..types.token", "api/types/token.py"),
        ("api/auth/service.py", "api.config", "api/config.py"),
        ("api/auth/service.py", ".helpers", "api/auth/helpers/__init__.py"),
    ],
)
def test_python_resolves_imports(
    py: PythonAdapter, importer: str, target: str, expected: str
):
    table = InMemorySymbolTable(paths={expected, importer})
    assert py.resolve(ImportRef(path=importer, target=target, kind="from"), table) == [expected]


def test_python_resolves_against_a_source_root(py: PythonAdapter):
    table = InMemorySymbolTable(paths={"src/api/config.py", "api/auth/service.py"})
    ref = ImportRef(path="api/auth/service.py", target="api.config", kind="from")
    assert py.resolve(ref, table) == ["src/api/config.py"]


def test_python_stdlib_resolves_to_nothing(py: PythonAdapter):
    table = InMemorySymbolTable(paths={"api/auth/service.py"})
    ref = ImportRef(path="api/auth/service.py", target="hashlib", kind="import")
    assert py.resolve(ref, table) == []


def test_python_relative_import_above_the_root_is_safe(py: PythonAdapter):
    table = InMemorySymbolTable(paths={"a.py"})
    assert py.resolve(ImportRef(path="a.py", target="....x", kind="from"), table) == []


# -- go ---------------------------------------------------------------------


@pytest.fixture
def go() -> GoAdapter:
    return GoAdapter()


def test_go_chunks_flat_declarations(go: GoAdapter):
    """Go methods sit at file scope with a receiver, not inside their type."""
    symbols = [c.symbol for c in go.chunk("auth.go", _read("go", "auth_service.go"))]
    assert "NewAuthService" in symbols
    assert "Refresh" in symbols
    assert any("AuthService" in s or "RefreshResult" in s for s in symbols)


def test_go_symbols_include_package_and_types(go: GoAdapter):
    found = {(s.name, s.kind) for s in go.symbols("a.go", _read("go", "auth_service.go"))}
    assert ("auth", "package") in found
    assert ("AuthService", "type") in found
    assert ("RotateRefreshToken", "function") in found


def test_go_import_paths(go: GoAdapter):
    targets = {r.target for r in go.import_refs("a.go", _read("go", "auth_service.go"))}
    assert targets == {"crypto/sha256", "encoding/hex", "github.com/example/api/internal/tokens"}


def test_go_resolves_module_qualified_import_to_a_package_directory(go: GoAdapter):
    table = InMemorySymbolTable(
        paths={
            "internal/tokens/helper.go",
            "internal/tokens/rotate.go",
            "internal/other/x.go",
            "auth/service.go",
        }
    )
    ref = ImportRef(
        path="auth/service.go", target="github.com/example/api/internal/tokens", kind="import"
    )
    assert go.resolve(ref, table) == ["internal/tokens/helper.go", "internal/tokens/rotate.go"]


def test_go_stdlib_import_resolves_to_nothing(go: GoAdapter):
    table = InMemorySymbolTable(paths={"auth/service.go"})
    ref = ImportRef(path="auth/service.go", target="fmt", kind="import")
    assert go.resolve(ref, table) == []


def test_go_package_fanout_is_capped(go: GoAdapter):
    paths = {f"pkg/util/f{i}.go" for i in range(20)} | {"a/b.go"}
    table = InMemorySymbolTable(paths=paths)
    ref = ImportRef(path="a/b.go", target="example.com/m/pkg/util", kind="import")
    assert len(go.resolve(ref, table)) <= 8


# -- registry ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("lang", "expected"),
    [
        ("csharp", "csharp"),
        ("typescript", "typescript"),
        ("javascript", "typescript"),
        ("python", "python"),
        ("go", "go"),
        ("markdown", "fallback"),
        ("shell", "fallback"),
    ],
)
def test_registry_maps_languages_to_adapters(lang: str, expected: str):
    assert adapter_for(lang).lang == expected
