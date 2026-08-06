"""Filesystem watcher with debounce (decision 17).

Indexing runs off the request path so the hook always queries an already-warm index. Events are
coalesced into a batch that fires once the tree has been quiet for ``debounce_ms``, which matters
because a single editor save or a git checkout produces a burst of events.

``on_batch`` runs on a timer thread, so it must open its own database connection.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from pathlib import Path

from .walker import ALWAYS_IGNORE_DIRS, classify_lang

BatchFn = Callable[[set[str]], None]

log = logging.getLogger(__name__)


class RepoWatcher:
    def __init__(
        self,
        repo_root: Path | str,
        on_batch: BatchFn,
        *,
        debounce_ms: int = 1000,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self._on_batch = on_batch
        self._debounce = debounce_ms / 1000.0
        self._pending: set[str] = set()
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._observer = None

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        from watchdog.observers import Observer

        handler = _Handler(self)
        self._observer = Observer()
        self._observer.schedule(handler, str(self.repo_root), recursive=True)
        self._observer.start()

    def stop(self, *, flush: bool = False) -> None:
        if self._observer is not None:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
        with self._lock:
            timer, self._timer = self._timer, None
        if timer is not None:
            timer.cancel()
        if flush:
            self._fire()

    # -- event intake ------------------------------------------------------

    def relative(self, raw: str) -> str | None:
        """Repo-relative POSIX path, or None if the event is not interesting."""
        try:
            rel = Path(raw).resolve().relative_to(self.repo_root)
        except ValueError:
            return None
        parts = rel.parts
        if any(part in ALWAYS_IGNORE_DIRS for part in parts[:-1]):
            return None
        if classify_lang(rel.name) is None:
            return None
        return rel.as_posix()

    def offer(self, raw: str) -> None:
        rel = self.relative(raw)
        if rel is None:
            return
        with self._lock:
            self._pending.add(rel)
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._debounce, self._fire)
            self._timer.daemon = True
            self._timer.start()

    def _fire(self) -> None:
        with self._lock:
            batch, self._pending = self._pending, set()
            self._timer = None
        if not batch:
            return
        try:
            self._on_batch(batch)
        except Exception:
            # Timer threads swallow exceptions silently; a dropped batch must at least be visible.
            log.exception("index batch failed for %d path(s)", len(batch))


class _Handler:
    """Adapts watchdog events onto RepoWatcher.offer without importing watchdog at module load."""

    def __init__(self, watcher: RepoWatcher) -> None:
        self._watcher = watcher

    def dispatch(self, event) -> None:
        if getattr(event, "is_directory", False):
            return
        for attr in ("src_path", "dest_path"):
            raw = getattr(event, attr, None)
            if raw:
                self._watcher.offer(raw if isinstance(raw, str) else raw.decode())
