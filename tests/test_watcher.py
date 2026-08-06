from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.db import connect
from hybrid_retrieval.index import RepoWatcher, index_repo

DEBOUNCE_MS = 80
TIMEOUT_S = 10.0


class Collector:
    """Records batches delivered by the watcher, and lets a test block until one arrives."""

    def __init__(self) -> None:
        self.batches: list[set[str]] = []
        self.received = threading.Event()

    def __call__(self, batch: set[str]) -> None:
        self.batches.append(batch)
        self.received.set()

    def wait(self, timeout: float = TIMEOUT_S) -> set[str]:
        assert self.received.wait(timeout), "watcher never delivered a batch"
        self.received.clear()
        return self.batches[-1]


@pytest.fixture
def watcher_and_collector(git_repo: Path):
    collector = Collector()
    watcher = RepoWatcher(git_repo, collector, debounce_ms=DEBOUNCE_MS)
    watcher.start()
    yield watcher, collector
    watcher.stop()


# -- filtering (no threads, no timing) --------------------------------------


def test_relative_accepts_source_files(git_repo: Path):
    watcher = RepoWatcher(git_repo, lambda _: None)
    assert watcher.relative(str(git_repo / "src" / "A.cs")) == "src/A.cs"


@pytest.mark.parametrize(
    "rel",
    [
        "logo.png",
        ".git/index",
        ".retrieval/index.db",
        "node_modules/pkg/a.ts",
        "obj/Debug/A.cs",
    ],
)
def test_relative_rejects_uninteresting_paths(git_repo: Path, rel: str):
    watcher = RepoWatcher(git_repo, lambda _: None)
    assert watcher.relative(str(git_repo / rel)) is None


def test_relative_rejects_paths_outside_the_repo(git_repo: Path, tmp_path: Path):
    watcher = RepoWatcher(git_repo, lambda _: None)
    assert watcher.relative(str(tmp_path.parent / "elsewhere" / "A.cs")) is None


# -- debounce ---------------------------------------------------------------


def test_burst_of_writes_coalesces_into_one_batch(git_repo: Path, watcher_and_collector):
    _, collector = watcher_and_collector
    for i in range(5):
        write(git_repo, f"src/T{i}.cs", f"public class T{i} {{ }}")
    batch = collector.wait()
    assert batch == {f"src/T{i}.cs" for i in range(5)}
    assert len(collector.batches) == 1, "a burst must not fire once per event"


def test_quiet_period_separates_batches(git_repo: Path, watcher_and_collector):
    _, collector = watcher_and_collector
    write(git_repo, "src/A.cs", "public class A { }")
    assert collector.wait() == {"src/A.cs"}
    write(git_repo, "src/B.cs", "public class B { }")
    assert collector.wait() == {"src/B.cs"}


def test_ignored_files_never_wake_the_indexer(git_repo: Path, watcher_and_collector):
    _, collector = watcher_and_collector
    write(git_repo, "logo.png", b"\x89PNG\r\n\x1a\n")
    write(git_repo, "node_modules/x/y.ts", "export {};")
    time.sleep(DEBOUNCE_MS / 1000 * 4)
    assert collector.batches == []


def test_deletions_are_reported(git_repo: Path, watcher_and_collector):
    _, collector = watcher_and_collector
    target = write(git_repo, "src/A.cs", "public class A { }")
    collector.wait()
    target.unlink()
    assert "src/A.cs" in collector.wait()


def test_stop_is_idempotent(git_repo: Path):
    watcher = RepoWatcher(git_repo, lambda _: None, debounce_ms=DEBOUNCE_MS)
    watcher.start()
    watcher.stop()
    watcher.stop()


# -- integration ------------------------------------------------------------


def test_watch_to_index_round_trip(git_repo: Path):
    """The exit criterion for M1: an edit lands in the index without a full rescan."""
    write(git_repo, "src/JwtService.cs", "namespace Api.Auth;\npublic class JwtService { }\n")
    conn = connect(git_repo)
    try:
        index_repo(git_repo, conn=conn)

        done = threading.Event()
        elapsed: list[float] = []

        def on_batch(changed: set[str]) -> None:
            # sqlite3 connections are thread-bound; the callback runs on the debounce timer
            # thread, so it must open its own. This is the contract RepoWatcher documents.
            started = time.perf_counter()
            index_repo(git_repo, paths=changed)
            elapsed.append(time.perf_counter() - started)
            done.set()

        watcher = RepoWatcher(git_repo, on_batch, debounce_ms=DEBOUNCE_MS)
        watcher.start()
        try:
            write(
                git_repo,
                "src/JwtService.cs",
                "namespace Api.Auth;\npublic class JwtService { public void Rotate() { } }\n",
            )
            assert done.wait(TIMEOUT_S), "edit never reached the indexer"
        finally:
            watcher.stop()

        symbols = {r[0] for r in conn.execute("SELECT symbol FROM chunks")}
        assert "JwtService.Rotate" in symbols
        assert elapsed[0] < 1.0, "incremental update must stay under a second"
    finally:
        conn.close()
