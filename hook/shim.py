#!/usr/bin/env python3
"""Claude Code UserPromptSubmit hook (decisions 4, 5, 7).

Deliberately standard-library only and dependency-free: this runs before every prompt, so import
cost is user-visible latency. All real work happens in the resident daemon.

Fails open, always. Any error, timeout, missing daemon or unindexed repo results in exit code 0
with no injected context. A retrieval tool must never be able to break a session.
"""

from __future__ import annotations

import contextlib
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

TIMEOUT_S = float(os.environ.get("HYBRID_RETRIEVAL_TIMEOUT", "3.0"))
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def socket_path() -> Path:
    override = os.environ.get("HYBRID_RETRIEVAL_SOCKET")
    if override:
        return Path(override).expanduser()
    cache = os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache")
    return Path(cache) / "hybrid-retrieval" / "daemon.sock"


def find_repo_root(start: Path) -> Path | None:
    start = start.resolve()
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def ask_daemon(payload: dict) -> dict | None:
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(TIMEOUT_S)
            sock.connect(str(socket_path()))
            sock.sendall((json.dumps(payload) + "\n").encode())
            chunks = []
            while not (chunks and chunks[-1].endswith(b"\n")):
                block = sock.recv(65536)
                if not block:
                    break
                chunks.append(block)
    except OSError:
        return None
    try:
        return json.loads(b"".join(chunks).decode("utf-8", "replace") or "{}")
    except ValueError:
        return None


def autostart() -> None:
    """Launch the daemon detached. This prompt gets nothing; the next one will.

    The daemon holds a singleton lock, so a racing shim exits harmlessly. Tests set
    HYBRID_RETRIEVAL_NO_AUTOSTART to avoid spawning a real, model-loading process.
    """
    if os.environ.get("HYBRID_RETRIEVAL_NO_AUTOSTART"):
        return
    python = PROJECT_ROOT / ".venv" / "bin" / "python"
    if not python.exists():
        return
    with contextlib.suppress(OSError):
        subprocess.Popen(
            [str(python), "-m", "hybrid_retrieval.cli", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            cwd=str(PROJECT_ROOT),
        )


HEADER = (
    "Files ranked for this prompt by local hybrid retrieval (BM25 + vectors + import graph). "
    "A ranked guess, not a constraint: open what looks useful and ignore the rest."
)


def render(paths: list[str]) -> str:
    """A ranked path list, not the file contents (SPEC 10j).

    Decision 29 specified full file contents and measurement reversed it. Assembling the top 5 of
    this repo for one prompt measured 78,260 characters, about 19,600 tokens, against a ~2,095
    token break-even; and hook output above ~40KB is spilled by the harness to a file whose pointer
    the agent then spends turns reading, which is worse than injecting nothing at all. Paths cost
    roughly 2% of that and still remove the search: the agent opens three named files instead of
    grepping for them.
    """
    if not paths:
        return ""
    listing = "\n".join(f"{i:>2}. {path}" for i, path in enumerate(paths, start=1))
    return f"<retrieved-context>\n{HEADER}\n{listing}\n</retrieved-context>"


def emit(context: str) -> None:
    if not context:
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": context,
                }
            }
        )
    )


def main() -> int:
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0

    prompt = (event.get("prompt") or "").strip()
    if not prompt:
        return 0

    cwd = Path(event.get("cwd") or os.getcwd())
    repo = find_repo_root(cwd)
    if repo is None:
        return 0

    payload = {
        "op": "retrieve",
        "repo": str(repo),
        "prompt": prompt,
        "session_id": event.get("session_id"),
        # The daemon would otherwise read all five selected files and build a string this hook
        # discards. It costs the daemon work and buys nothing, since `render` uses only the paths.
        "assemble": False,
    }

    response = ask_daemon(payload)
    if response is None:
        autostart()
        return 0
    if response.get("ok"):
        emit(render(response.get("paths") or []))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - fail open, never break the session
        sys.exit(0)
