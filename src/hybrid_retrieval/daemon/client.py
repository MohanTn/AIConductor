"""Synchronous socket client. Used by the CLI; the hook shim carries its own stdlib-only copy."""

from __future__ import annotations

import json
import socket
from pathlib import Path

from .. import paths


class DaemonUnavailable(RuntimeError):
    pass


def request(payload: dict, *, socket_path: Path | None = None, timeout: float = 3.0) -> dict:
    target = str(socket_path or paths.socket_path())
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect(target)
            sock.sendall((json.dumps(payload) + "\n").encode())
            chunks: list[bytes] = []
            while not (chunks and chunks[-1].endswith(b"\n")):
                block = sock.recv(65536)
                if not block:
                    break
                chunks.append(block)
    except (TimeoutError, OSError) as exc:
        raise DaemonUnavailable(str(exc)) from exc

    body = b"".join(chunks).decode("utf-8", "replace").strip()
    if not body:
        raise DaemonUnavailable("empty response")
    return json.loads(body)
