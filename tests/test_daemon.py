from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.config import Config
from hybrid_retrieval.daemon import Daemon, DaemonUnavailable, request

SHIM = Path(__file__).resolve().parents[1] / "hook" / "shim.py"

JWT = """namespace Api.Auth;

public class JwtService
{
    public string RotateRefreshToken(string token) => token;
}
"""


@pytest.fixture
def repo(git_repo: Path) -> Path:
    write(git_repo, "src/JwtService.cs", JWT)
    return git_repo


@pytest.fixture
def daemon(tmp_path: Path):
    """A live daemon on its own loop thread, embeddings disabled so tests stay fast."""
    cfg = Config()
    cfg.embed.enabled = False
    socket_path = tmp_path / "daemon.sock"
    server = Daemon(cfg, socket_path=socket_path)

    loop = asyncio.new_event_loop()
    ready = threading.Event()

    def run() -> None:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(server.start())
        ready.set()
        loop.run_forever()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    assert ready.wait(15), "daemon never started"

    yield socket_path

    asyncio.run_coroutine_threadsafe(server.close(), loop).result(10)
    loop.call_soon_threadsafe(loop.stop)
    thread.join(10)


def test_ping(daemon: Path):
    response = request({"op": "ping"}, socket_path=daemon)
    assert response["ok"] is True
    assert response["protocol"] == 1


def test_retrieve_cold_starts_the_index(daemon: Path, repo: Path):
    """First contact with an unknown repo builds the sparse index synchronously (decision 18)."""
    response = request(
        {"op": "retrieve", "repo": str(repo), "prompt": "rotate the refresh token"},
        socket_path=daemon,
        timeout=30,
    )
    assert response["ok"] is True
    assert response["paths"] == ["src/JwtService.cs"]
    assert "RotateRefreshToken" in response["context"]
    assert response["dense_used"] is False
    assert response["tokens"] > 0


def test_second_request_reuses_the_warm_index(daemon: Path, repo: Path):
    payload = {"op": "retrieve", "repo": str(repo), "prompt": "refresh token"}
    request(payload, socket_path=daemon, timeout=30)
    response = request(payload, socket_path=daemon, timeout=30)
    assert response["latency_ms"] < 1000


def test_unknown_op_is_rejected_without_dying(daemon: Path):
    assert request({"op": "nonsense"}, socket_path=daemon)["ok"] is False
    assert request({"op": "ping"}, socket_path=daemon)["ok"] is True


def test_missing_fields_are_rejected(daemon: Path):
    assert request({"op": "retrieve"}, socket_path=daemon)["ok"] is False


def test_unknown_repo_is_rejected(daemon: Path, tmp_path: Path):
    response = request(
        {"op": "retrieve", "repo": str(tmp_path / "nope"), "prompt": "x"}, socket_path=daemon
    )
    assert response["ok"] is False


def test_client_reports_a_missing_daemon(tmp_path: Path):
    with pytest.raises(DaemonUnavailable):
        request({"op": "ping"}, socket_path=tmp_path / "absent.sock", timeout=1)


# -- hook shim --------------------------------------------------------------


def _run_shim(event: dict, socket_path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SHIM)],
        input=json.dumps(event),
        capture_output=True,
        text=True,
        timeout=60,
        env={
            "PATH": "/usr/bin:/bin",
            "HYBRID_RETRIEVAL_SOCKET": str(socket_path),
            # Without this the shim spawns a real daemon that loads a 1.2GB model and never exits.
            "HYBRID_RETRIEVAL_NO_AUTOSTART": "1",
        },
    )


def test_shim_injects_context(daemon: Path, repo: Path):
    result = _run_shim(
        {"prompt": "rotate the refresh token", "cwd": str(repo), "session_id": "s1"}, daemon
    )
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    block = payload["hookSpecificOutput"]
    assert block["hookEventName"] == "UserPromptSubmit"
    assert "RotateRefreshToken" in block["additionalContext"]


def test_shim_is_silent_when_the_daemon_is_absent(repo: Path, tmp_path: Path):
    """Fails open (decision 7): no daemon means no context, never a broken session."""
    result = _run_shim({"prompt": "anything", "cwd": str(repo)}, tmp_path / "absent.sock")
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_shim_ignores_an_empty_prompt(daemon: Path, repo: Path):
    result = _run_shim({"prompt": "   ", "cwd": str(repo)}, daemon)
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_shim_ignores_a_non_repo_directory(daemon: Path, tmp_path: Path):
    outside = tmp_path / "not-a-repo"
    outside.mkdir()
    result = _run_shim({"prompt": "hello there", "cwd": str(outside)}, daemon)
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_shim_survives_malformed_stdin(daemon: Path):
    result = subprocess.run(
        [sys.executable, str(SHIM)],
        input="not json at all",
        capture_output=True,
        text=True,
        timeout=60,
        env={"PATH": "/usr/bin:/bin", "HYBRID_RETRIEVAL_SOCKET": str(daemon)},
    )
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_shutdown_exits_cleanly(tmp_path: Path):
    """A clean stop must not raise, or a supervisor reads it as a crash and restart-loops."""
    import asyncio

    cfg = Config()
    cfg.embed.enabled = False
    server = Daemon(cfg, socket_path=tmp_path / "shutdown.sock")

    async def scenario() -> None:
        await server.start()
        serving = asyncio.ensure_future(server.serve_forever())
        await server.dispatch({"op": "shutdown"})
        await asyncio.wait_for(serving, timeout=5)
        await server.close()

    asyncio.run(scenario())  # raises if the loop is stopped from inside


def test_only_one_daemon_can_hold_the_socket(daemon: Path):
    """Ten daemons each loading their own model is how a 4GB GPU runs out of memory."""
    import asyncio

    from hybrid_retrieval.daemon.server import AlreadyRunning, Daemon

    cfg = Config()
    cfg.embed.enabled = False
    second = Daemon(cfg, socket_path=daemon)
    with pytest.raises(AlreadyRunning):
        asyncio.run(second.start())


def test_shim_uses_only_the_standard_library():
    """It runs before every prompt, so import cost is user-visible latency."""
    import ast
    import sys as _sys

    imported: set[str] = set()
    for node in ast.walk(ast.parse(SHIM.read_text())):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imported.add(node.module.split(".")[0])

    non_stdlib = imported - _sys.stdlib_module_names
    assert non_stdlib == set(), f"shim must not import {sorted(non_stdlib)}"
