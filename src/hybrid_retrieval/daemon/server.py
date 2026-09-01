"""Resident daemon: one process, every repo, unix socket (decision 6).

Why a daemon at all: a Python interpreter plus a 0.6B embedding model is 10-30 seconds of cold
start, and the hook has a 3 second budget. The model is loaded once here and every prompt from
every repo reuses it.

Threading contract. sqlite3 connections are bound to the thread that created them:
  * the per-repo connection used to answer requests lives on the event loop thread;
  * the watcher's debounce callback and the dense backfill each open their own.
WAL keeps a concurrent reader and writer safe across those separate connections.

Cold start follows decision 18: the sparse index is built synchronously on first contact with a
repo (seconds), dense embeddings fill in behind it.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import os
import sqlite3
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .. import paths, trace
from ..config import Config
from ..db import connect
from ..embed import embed_pending, pending_count
from ..index import RepoWatcher, index_repo
from ..retrieve import retrieve

log = logging.getLogger(__name__)

PROTOCOL_VERSION = 1


class AlreadyRunning(RuntimeError):
    """Another daemon already holds the socket lock."""


@dataclass
class RepoState:
    root: Path
    cfg: Config
    conn: sqlite3.Connection
    watcher: RepoWatcher | None = None
    ranker: object | None = None
    history: object | None = None
    dirty: threading.Event = field(default_factory=threading.Event)


class Daemon:
    def __init__(self, cfg: Config | None = None, *, socket_path: Path | None = None) -> None:
        self.cfg = cfg or Config.load()
        self.socket_path = socket_path or self.cfg.socket_file()
        self._repos: dict[Path, RepoState] = {}
        self._embedder = None
        self._embedder_error: str | None = None
        self._embed_lock = threading.Lock()
        self._server: asyncio.AbstractServer | None = None
        self._tasks: set[asyncio.Task] = set()
        self._lock_handle = None
        self._stopped: asyncio.Event | None = None

    # -- lifecycle ---------------------------------------------------------

    def _acquire_singleton(self) -> bool:
        """Exclusive lock on a pidfile beside the socket.

        Without this, every autostart spawns another daemon: the socket-exists check races, and
        binding would happily unlink a *live* socket and steal it. Each daemon loads its own copy
        of the embedding model, so on a small GPU the second one is an out-of-memory error and the
        tenth is a mystery.
        """
        # Not a context manager: the handle must stay open for the daemon's whole life, because
        # closing it releases the flock.
        self._lock_handle = open(self.socket_path.with_suffix(".pid"), "w")  # noqa: SIM115
        try:
            fcntl.flock(self._lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lock_handle.close()
            self._lock_handle = None
            return False
        self._lock_handle.write(str(os.getpid()))
        self._lock_handle.flush()
        return True

    async def start(self) -> None:
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        if not self._acquire_singleton():
            raise AlreadyRunning(f"another daemon holds {self.socket_path}")
        if self.socket_path.exists():
            self.socket_path.unlink()  # ours to reclaim, the lock proved nobody else has it
        self._stopped = asyncio.Event()
        self._server = await asyncio.start_unix_server(self._handle, path=str(self.socket_path))
        log.info("listening on %s", self.socket_path)
        if self.cfg.embed.enabled:
            self._spawn(self._load_embedder())
        self._spawn(self._backfill_loop())

    async def serve_forever(self) -> None:
        """Block until shutdown is requested.

        Waiting on an event rather than `Server.serve_forever` on purpose: the socket server is
        already accepting from the moment `start_unix_server` returns, and stopping the loop from
        inside `asyncio.run` makes `run_until_complete` raise "Event loop stopped before Future
        completed", so a clean `stop` would exit non-zero and look like a crash to a supervisor.
        """
        assert self._server is not None and self._stopped is not None
        async with self._server:
            await self._stopped.wait()

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
        for state in self._repos.values():
            if state.watcher is not None:
                state.watcher.stop()
            state.conn.close()
        self._repos.clear()
        self.socket_path.unlink(missing_ok=True)
        if self._lock_handle is not None:
            fcntl.flock(self._lock_handle, fcntl.LOCK_UN)
            self._lock_handle.close()
            self._lock_handle = None

    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # -- model -------------------------------------------------------------

    async def _load_embedder(self) -> None:
        def build():
            from ..embed import Embedder

            return Embedder(
                self.cfg.embed.model_id,
                device=self.cfg.embed.device,
                max_seq_length=self.cfg.embed.max_seq_length,
                batch_size=self.cfg.embed.batch_size,
                trust_remote_code=self.cfg.embed.trust_remote_code,
            )

        try:
            started = time.perf_counter()
            self._embedder = await asyncio.to_thread(build)
            log.info(
                "embedder %s ready in %.1fs (dim=%d)",
                self.cfg.embed.model_id,
                time.perf_counter() - started,
                self._embedder.dim,
            )
        except Exception as exc:  # noqa: BLE001 - degrade to sparse-only, never die
            self._embedder_error = str(exc)
            log.exception("embedder failed to load; retrieval stays sparse-only")

    async def _backfill_loop(self) -> None:
        """Embed whatever the indexer has marked pending, off the request path."""
        ticks = 0
        while True:
            await asyncio.sleep(self.cfg.embed.backfill_interval_s)
            ticks += 1
            if ticks % 720 == 0:  # roughly hourly at the default interval
                self._prune_traces()
            if self._embedder is None:
                continue
            for state in list(self._repos.values()):
                try:
                    if pending_count(state.conn) == 0:
                        continue
                    await asyncio.to_thread(self._embed_repo, state)
                except Exception:  # noqa: BLE001
                    log.exception("backfill failed for %s", state.root)

    def _prune_traces(self) -> None:
        for state in list(self._repos.values()):
            try:
                removed = trace.prune(state.conn)
                if removed:
                    log.info("pruned %d expired traces from %s", removed, state.root)
            except Exception:  # noqa: BLE001
                log.exception("trace prune failed for %s", state.root)

    def _embed_repo(self, state: RepoState) -> None:
        with self._embed_lock:  # one GPU, one consumer at a time
            stats = embed_pending(
                state.root,
                self._embedder,
                files_per_batch=state.cfg.embed.files_per_batch,
                min_chunk_tokens=state.cfg.embed.min_chunk_tokens,
            )
        if stats.files:
            log.info("%s: %s", state.root, stats)

    # -- repos -------------------------------------------------------------

    def _state(self, repo_root: Path) -> RepoState:
        existing = self._repos.get(repo_root)
        if existing is not None:
            return existing

        cfg = Config.load(repo_root)
        conn = connect(repo_root)
        state = RepoState(root=repo_root, cfg=cfg, conn=conn)

        indexed = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        if indexed == 0:
            stats = index_repo(repo_root, conn=conn, cfg=cfg)
            log.info("cold start %s: %s", repo_root, stats)

        def on_batch(changed: set[str]) -> None:
            index_repo(repo_root, cfg=cfg, paths=changed)  # own connection, own thread

        watcher = RepoWatcher(repo_root, on_batch, debounce_ms=cfg.index.debounce_ms)
        watcher.start()
        state.watcher = watcher

        # A missing or unloadable ranker leaves the fused order in place rather than failing.
        try:
            from ..rank import Ranker

            state.ranker = Ranker.load(repo_root)
            if state.ranker is not None:
                from ..gitlog import load_history

                state.history = load_history(repo_root)
                log.info("ranker loaded for %s", repo_root)
        except Exception:  # noqa: BLE001
            log.exception("ranker unavailable for %s; using fused order", repo_root)
            state.ranker = None

        self._repos[repo_root] = state
        return state

    # -- requests ----------------------------------------------------------

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            line = await reader.readline()
            if not line:
                return
            request = json.loads(line)
            response = await self.dispatch(request)
        except Exception as exc:  # noqa: BLE001 - a bad request must not kill the daemon
            log.exception("request failed")
            response = {"ok": False, "error": str(exc)}
        try:
            writer.write((json.dumps(response) + "\n").encode())
            await writer.drain()
        finally:
            writer.close()

    async def dispatch(self, request: dict) -> dict:
        op = request.get("op", "retrieve")
        if op == "ping":
            return {
                "ok": True,
                "protocol": PROTOCOL_VERSION,
                "embedder": self.cfg.embed.model_id if self._embedder else None,
                "embedder_error": self._embedder_error,
                "repos": [str(p) for p in self._repos],
            }
        if op == "retrieve":
            return await self._retrieve(request)
        if op == "shutdown":
            self._spawn(self._shutdown_soon())
            return {"ok": True}
        return {"ok": False, "error": f"unknown op {op!r}"}

    async def _shutdown_soon(self) -> None:
        # Let the response reach the client before tearing the socket down.
        await asyncio.sleep(0.05)
        if self._stopped is not None:
            self._stopped.set()

    async def _retrieve(self, request: dict) -> dict:
        raw_repo = request.get("repo")
        prompt = (request.get("prompt") or "").strip()
        if not raw_repo or not prompt:
            return {"ok": False, "error": "repo and prompt are required"}

        repo_root = Path(raw_repo).resolve()
        if not repo_root.is_dir():
            return {"ok": False, "error": f"no such repo {repo_root}"}

        state = self._state(repo_root)
        result = retrieve(
            repo_root,
            prompt,
            conn=state.conn,
            embedder=self._embedder,
            cfg=state.cfg,
            ranker=state.ranker,
            history=state.history,
            # Clients that render the payload themselves ask for paths only, so the daemon does
            # not read five files and build a string they will discard.
            assemble_context=bool(request.get("assemble", True)),
        )
        trace_id = trace.record(
            state.conn, prompt=prompt, result=result, session_id=request.get("session_id")
        )
        context = result.context
        response = {
            "ok": True,
            "context": context.text if context else "",
            "paths": result.paths,
            "tokens": context.tokens if context else 0,
            "dense_used": result.dense_used,
            "reranked": result.reranked,
            "fell_back": result.fell_back,
            "skipped": result.skipped or None,
            "gate": result.gate.decision if result.gate else None,
            "trace_id": trace_id,
            "latency_ms": round(result.latency_ms, 2),
            "stage_ms": {k: round(v, 2) for k, v in result.stage_ms.items()},
        }
        if request.get("rank"):
            # The pre-cut ranked candidates, for `query --rank` to inspect score separation
            # without paying for its own cold embedder load (decision: reuse the resident model).
            response["fused"] = [asdict(c) for c in result.fused[:10]]
        return response


async def _run(cfg: Config | None = None) -> None:
    daemon = Daemon(cfg)
    await daemon.start()
    try:
        await daemon.serve_forever()
    except asyncio.CancelledError:
        pass
    finally:
        await daemon.close()


def serve(cfg: Config | None = None) -> int:
    log_file = paths.log_path()
    log_file.parent.mkdir(parents=True, exist_ok=True)  # must precede basicConfig
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        filename=str(log_file),
    )
    try:
        asyncio.run(_run(cfg))
    except KeyboardInterrupt:
        pass
    except AlreadyRunning as exc:
        log.info("%s; exiting", exc)
        return 0  # not an error: someone else is already serving
    return 0
