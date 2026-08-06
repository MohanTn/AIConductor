"""Filesystem locations. Index lives in the repo (decision 11), daemon state in the cache dir."""

from __future__ import annotations

import os
from pathlib import Path

APP = "hybrid-retrieval"
INDEX_DIRNAME = ".retrieval"


def _xdg(var: str, default: str) -> Path:
    return Path(os.environ.get(var) or Path.home() / default).expanduser()


def cache_dir() -> Path:
    return _xdg("XDG_CACHE_HOME", ".cache") / APP


def config_dir() -> Path:
    return _xdg("XDG_CONFIG_HOME", ".config") / APP


def global_config_file() -> Path:
    return config_dir() / "config.toml"


def index_dir(repo_root: Path) -> Path:
    return Path(repo_root) / INDEX_DIRNAME


def db_path(repo_root: Path) -> Path:
    return index_dir(repo_root) / "index.db"


def repo_config_file(repo_root: Path) -> Path:
    return index_dir(repo_root) / "config.toml"


def socket_path() -> Path:
    """Daemon socket location.

    The env override exists because the hook shim reads it, and shim, client, CLI and daemon must
    all agree on where the socket is or relocating it half-works.
    """
    override = os.environ.get("HYBRID_RETRIEVAL_SOCKET")
    if override:
        return Path(override).expanduser()
    return cache_dir() / "daemon.sock"


def log_path() -> Path:
    return cache_dir() / "daemon.log"


def find_repo_root(start: Path) -> Path | None:
    """Nearest ancestor containing a .git entry (file or directory, so worktrees work)."""
    start = Path(start).resolve()
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return None
