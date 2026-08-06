"""Repo enumeration.

Candidate paths come from ``git ls-files`` when the repo is a git checkout: it already honours
nested .gitignore files, global excludes and the assume-unchanged bits, and it is faster than any
walk we would write. A pathspec-based walk is the fallback for non-git directories.
"""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path

from ..types import FileRecord
from .hashing import hash_bytes

# Languages with a real adapter (symbol-level chunking and import resolution) plus the file types
# that carry meaning in a repo even without one. Anything not listed here is invisible to
# retrieval entirely, which is how a dotfiles repo ended up with 27 of its files indexed.
LANG_BY_EXT: dict[str, str] = {
    # adapters exist or are planned (decision 35)
    ".cs": "csharp",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".pyi": "python",
    ".go": "go",
    # window-chunked via the fallback adapter: no symbols, no edges, but searchable
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".fish": "shell",
    ".lua": "lua",
    ".toml": "toml",
    ".md": "markdown",
    ".markdown": "markdown",
}

# Extensionless files that are still shell scripts by convention.
LANG_BY_NAME: dict[str, str] = {
    ".bashrc": "shell",
    ".zshrc": "shell",
    ".profile": "shell",
    ".bash_profile": "shell",
    ".zprofile": "shell",
    ".bash_aliases": "shell",
}

ALWAYS_IGNORE_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".retrieval",
        "node_modules",
        "bin",
        "obj",
        "dist",
        "build",
        "out",
        "target",
        "vendor",
        "__pycache__",
        ".venv",
        "venv",
        ".tox",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
    }
)

_BINARY_SNIFF = 8192


def classify_lang(path: str | Path) -> str | None:
    name = Path(path).name.lower()
    if name in LANG_BY_NAME:
        return LANG_BY_NAME[name]
    return LANG_BY_EXT.get(Path(path).suffix.lower())


def _git_ls_files(repo_root: Path) -> list[str] | None:
    try:
        proc = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=repo_root,
            capture_output=True,
            timeout=30,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return [p for p in proc.stdout.decode("utf-8", "replace").split("\0") if p]


def _walk(repo_root: Path) -> list[str]:
    found: list[str] = []
    stack = [repo_root]
    while stack:
        current = stack.pop()
        try:
            entries = list(current.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if entry.name not in ALWAYS_IGNORE_DIRS:
                    stack.append(entry)
            elif entry.is_file():
                found.append(entry.relative_to(repo_root).as_posix())
    return found


def list_candidate_paths(repo_root: Path) -> list[str]:
    """Repo-relative POSIX paths that survive ignore rules, before language filtering."""
    paths = _git_ls_files(repo_root)
    if paths is None:
        paths = _walk(repo_root)
    return [
        p for p in paths if not any(part in ALWAYS_IGNORE_DIRS for part in Path(p).parts[:-1])
    ]


def _is_binary(data: bytes) -> bool:
    return b"\0" in data[:_BINARY_SNIFF]


def discover(repo_root: Path | str, *, max_file_bytes: int = 1_048_576) -> Iterator[FileRecord]:
    """Yield a FileRecord for every indexable source file in the working tree.

    Skips unsupported languages, oversized files, binaries and anything unreadable. Reads each
    file once and hashes what it read, so the hash always matches the bytes we chunk.
    """
    repo_root = Path(repo_root)
    for rel in list_candidate_paths(repo_root):
        lang = classify_lang(rel)
        if lang is None:
            continue
        absolute = repo_root / rel
        try:
            stat = absolute.stat()
        except OSError:
            continue
        if stat.st_size > max_file_bytes:
            continue
        try:
            data = absolute.read_bytes()
        except OSError:
            continue
        if _is_binary(data):
            continue
        yield FileRecord(
            path=rel,
            content_hash=hash_bytes(data),
            lang=lang,
            size_bytes=stat.st_size,
            mtime=stat.st_mtime,
        )
