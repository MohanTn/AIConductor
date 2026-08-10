"""HTTP layer for the dashboard.

Standard library only, and bound to localhost by default. This exposes repo contents and lets a
caller write config files, so it is not something to put on a network interface without thinking:
there is no authentication, because the only intended client is a browser on the same machine.
"""

from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import api

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
DEFAULT_PORT = 5111
MIME = {
    ".woff2": "font/woff2",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "hybrid-retrieval-dashboard"

    # -- plumbing ----------------------------------------------------------

    def log_message(self, fmt: str, *args) -> None:  # noqa: A002
        log.debug(fmt, *args)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload, status: int = 200) -> None:
        self._send(status, json.dumps(payload, default=str).encode(), "application/json")

    def _query(self) -> dict[str, str]:
        raw = parse_qs(urlparse(self.path).query)
        return {k: v[0] for k, v in raw.items()}

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError as exc:
            raise api.ApiError(f"invalid JSON body: {exc}") from exc

    def _static(self, route: str) -> None:
        """Serve files under `static/`. Resolved and re-checked so `..` cannot escape the dir."""
        target = (STATIC / route[len("/static/") :]).resolve()
        if not target.is_file() or STATIC.resolve() not in target.parents:
            self._json({"error": "not found"}, 404)
            return
        self._send(200, target.read_bytes(), MIME.get(target.suffix, "application/octet-stream"))

    # -- routes ------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        route = urlparse(self.path).path
        try:
            if route in ("/", "/index.html"):
                self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
            elif route == "/api/repos":
                self._json({"repos": api.discover_repos()})
            elif route == "/api/health":
                self._json(api.daemon_health())
            elif route == "/api/status":
                self._json(api.status(self._query().get("repo")))
            elif route == "/api/config":
                self._json(api.get_config(self._query().get("repo") or None))
            elif route == "/api/traces":
                params = self._query()
                self._json(
                    api.traces(params.get("repo"), limit=int(params.get("limit", 25)))
                )
            elif route == "/api/trace":
                params = self._query()
                self._json(api.one_trace(params.get("repo"), int(params.get("id", 0))))
            elif route == "/api/sessions":
                params = self._query()
                self._json(
                    api.sessions(
                        params.get("repo"),
                        limit=int(params.get("limit", 200)),
                        refresh=params.get("refresh", "1") != "0",
                        page=int(params.get("page", 1)),
                        page_size=int(params.get("page_size", 50)),
                    )
                )
            elif route.startswith("/static/"):
                self._static(route)
            else:
                self._json({"error": "not found"}, 404)
        except api.ApiError as exc:
            self._json({"error": str(exc)}, exc.status)
        except Exception as exc:  # noqa: BLE001 - a bad request must not kill the server
            log.exception("GET %s failed", route)
            self._json({"error": str(exc)}, 500)

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path
        try:
            body = self._body()
            if route == "/api/probe":
                self._json(api.probe(body.get("repo"), body.get("prompt", "")))
            elif route == "/api/config":
                self._json(
                    api.put_config(
                        body.get("repo"),
                        body.get("updates") or {},
                        scope=body.get("scope", "repo"),
                    )
                )
            else:
                self._json({"error": "not found"}, 404)
        except api.ApiError as exc:
            self._json({"error": str(exc)}, exc.status)
        except Exception as exc:  # noqa: BLE001
            log.exception("POST %s failed", route)
            self._json({"error": str(exc)}, 500)


def build(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


def serve(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> int:
    httpd = build(host, port)
    print(f"dashboard on http://{host}:{port}  (ctrl-c to stop)", flush=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        thread.join()
    except KeyboardInterrupt:
        httpd.shutdown()
    return 0
