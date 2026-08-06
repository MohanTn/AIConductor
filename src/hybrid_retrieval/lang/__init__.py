"""Language adapter registry."""

from __future__ import annotations

from .base import (
    NAMESPACE_KIND,
    ChunkRules,
    InMemorySymbolTable,
    LanguageAdapter,
    SymbolTable,
    estimate_tokens,
)
from .csharp import CSharpAdapter
from .fallback import FallbackAdapter
from .golang import GoAdapter
from .python_lang import PythonAdapter
from .typescript import TypeScriptAdapter

_typescript = TypeScriptAdapter()

_ADAPTERS: dict[str, LanguageAdapter] = {
    CSharpAdapter.lang: CSharpAdapter(),
    TypeScriptAdapter.lang: _typescript,
    "javascript": _typescript,  # same grammar family, same resolver
    PythonAdapter.lang: PythonAdapter(),
    GoAdapter.lang: GoAdapter(),
}
_FALLBACK = FallbackAdapter()


def adapter_for(lang: str) -> LanguageAdapter:
    """Adapter for a language, or the window-chunking fallback if none is implemented yet."""
    return _ADAPTERS.get(lang, _FALLBACK)


def has_adapter(lang: str) -> bool:
    return lang in _ADAPTERS


__all__ = [
    "NAMESPACE_KIND",
    "ChunkRules",
    "CSharpAdapter",
    "FallbackAdapter",
    "GoAdapter",
    "InMemorySymbolTable",
    "LanguageAdapter",
    "PythonAdapter",
    "SymbolTable",
    "TypeScriptAdapter",
    "adapter_for",
    "estimate_tokens",
    "has_adapter",
]
