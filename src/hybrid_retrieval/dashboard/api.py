"""Dashboard data layer.

Every handler is a plain function returning JSON-ready data, so the whole API is testable without
starting a server or a browser. The HTTP layer in `server.py` is only routing.

Live probes are proxied to the daemon rather than run in-process: the daemon already holds the
embedding model and the ranker, and proxying means the dashboard observes exactly what a real hook
request does, including the skip rule and the trace it writes.
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from .. import feedback, trace
from .. import paths as app_paths
from ..config import Config, apply_updates, overrides, save, to_dict
from ..db import connect, dense_config, schema_version
from ..rank import FEATURE_NAMES, Ranker


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _repo(raw: str | None) -> Path:
    if not raw:
        raise ApiError("repo is required")
    root = Path(raw).expanduser().resolve()
    if not (root / app_paths.INDEX_DIRNAME).is_dir():
        raise ApiError(f"no index at {root}; run `hybrid-retrieval index` first", 404)
    return root


def discover_repos() -> list[dict[str, Any]]:
    """Repos with an index, found via session history plus anything the daemon has open."""
    candidates: set[Path] = set()
    try:
        from ..sessions import group_by_repo, mine

        candidates.update(group_by_repo(mine()))
    except Exception:  # noqa: BLE001 - session formats are third-party
        pass
    try:
        from ..daemon import request

        for raw in request({"op": "ping"}, timeout=2.0).get("repos", []):
            candidates.add(Path(raw))
    except Exception:  # noqa: BLE001 - daemon is optional
        pass

    out = []
    for root in sorted(candidates):
        if not (root / app_paths.INDEX_DIRNAME / "index.db").exists():
            continue
        out.append({"path": str(root), "name": root.name})
    return out


def status(repo: str | None) -> dict[str, Any]:
    root = _repo(repo)
    conn = connect(root)
    try:
        one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
        dense = dense_config(conn)
        by_lang = [
            {"lang": lang, "files": count}
            for lang, count in conn.execute(
                "SELECT lang, COUNT(*) FROM files GROUP BY lang ORDER BY 2 DESC"
            )
        ]
        db_file = app_paths.db_path(root)
        ranker = _ranker_summary(root)
        return {
            "repo": str(root),
            "schema_version": schema_version(conn),
            "db_bytes": db_file.stat().st_size if db_file.exists() else 0,
            "files": one("SELECT COUNT(*) FROM files"),
            "dense_ready": one("SELECT COUNT(*) FROM files WHERE dense_ready = 1"),
            "chunks": one("SELECT COUNT(*) FROM chunks"),
            "symbols": one("SELECT COUNT(*) FROM symbols"),
            "imports": one("SELECT COUNT(*) FROM imports"),
            "edges": one("SELECT COUNT(*) FROM edges"),
            "traces": one("SELECT COUNT(*) FROM traces"),
            "embedder": {"model": dense[0], "dim": dense[1]} if dense else None,
            "by_lang": by_lang,
            "ranker": ranker,
        }
    finally:
        conn.close()


def _ranker_summary(root: Path) -> dict[str, Any] | None:
    try:
        ranker = Ranker.load(root)
    except Exception:  # noqa: BLE001
        return None
    if ranker is None:
        return None
    artefact = ranker.artefact
    return {
        "trained_on": artefact.trained_on,
        "n_queries": artefact.n_queries,
        "gate": artefact.gate,
        "metrics": artefact.metrics,
        "features": list(FEATURE_NAMES),
    }


def daemon_health() -> dict[str, Any]:
    try:
        from ..daemon import request

        response = request({"op": "ping"}, timeout=2.0)
        return {"running": True, **response}
    except Exception as exc:  # noqa: BLE001
        return {"running": False, "error": str(exc)}


def get_config(repo: str | None) -> dict[str, Any]:
    """Effective config, plus which values are overridden and where the files live."""
    root = Path(repo).expanduser().resolve() if repo else None
    effective = Config.load(root)
    return {
        "effective": to_dict(effective),
        "defaults": to_dict(Config()),
        "overrides": overrides(effective),
        "global_file": str(app_paths.global_config_file()),
        "repo_file": str(app_paths.repo_config_file(root)) if root else None,
        "scope": "repo" if root else "global",
    }


def put_config(repo: str | None, updates: dict[str, Any], *, scope: str = "repo") -> dict[str, Any]:
    """Write changed values to the chosen scope, then report the new effective config."""
    if not isinstance(updates, dict):
        raise ApiError("body must be a JSON object")
    root = Path(repo).expanduser().resolve() if repo else None
    if scope == "repo" and root is None:
        raise ApiError("repo scope needs a repo")

    target = app_paths.repo_config_file(root) if scope == "repo" else app_paths.global_config_file()
    # Start from the scope's own file so a repo edit never bakes in inherited global values.
    base = Config()
    if target.exists():
        apply_updates(base, _read_existing(target))
    apply_updates(base, updates)
    save(base, target)
    return {"written": str(target), **get_config(repo)}


def _read_existing(path: Path) -> dict[str, Any]:
    import tomllib

    try:
        with open(path, "rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def traces(repo: str | None, *, limit: int = 25) -> dict[str, Any]:
    root = _repo(repo)
    conn = connect(root)
    try:
        rows = trace.recent(conn, limit=limit)
        return {"repo": str(root), "traces": [asdict(r) for r in rows]}
    finally:
        conn.close()


def one_trace(repo: str | None, trace_id: int) -> dict[str, Any]:
    root = _repo(repo)
    conn = connect(root)
    try:
        row = trace.get(conn, trace_id)
        if row is None:
            raise ApiError(f"no trace {trace_id}", 404)
        return asdict(row)
    finally:
        conn.close()


def sessions(
    repo: str | None,
    *,
    limit: int = 200,
    refresh: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """Per-session view: each prompt, what was injected for it, and what the agent opened after.

    Reconciliation runs on read by default. Mining the transcripts costs a second or so and a
    session is still being appended to while someone is looking at it, so a stale view would be the
    normal case rather than the exception. Pass ``refresh=False`` to read what is already stored.

    ``page``/``page_size`` slice the session list only. Totals stay over every session in the
    window, so paging through the list never moves the headline numbers.
    """
    root = _repo(repo)
    conn = connect(root)
    try:
        stats = feedback.reconcile(root, conn, limit=limit) if refresh else {}
        rows = feedback.by_session(conn, limit=limit)
        totals = _totals(rows)
        size = max(1, page_size)
        pages = max(1, -(-len(rows) // size))
        current = min(max(1, page), pages)
        start = (current - 1) * size
        return {
            "repo": str(root),
            "reconcile": stats,
            "sessions": rows[start : start + size],
            "totals": totals,
            "page": current,
            "page_size": size,
            "pages": pages,
            "total": len(rows),
        }
    finally:
        conn.close()


def _totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Roll the per-session numbers up. Rates are over observed prompts only.

    An unobserved prompt contributes to neither numerator nor denominator: counting it as a miss
    would mean a session where the agent opened nothing looked exactly like one where retrieval
    failed, and those are opposite outcomes.
    """
    total = lambda key: sum(r[key] for r in rows)  # noqa: E731
    observed = total("observed")
    injected_observed = sum(
        len(o["injected"]) for r in rows for o in r["outcomes"] if o["observed"]
    )
    used = total("used_files")
    return {
        "sessions": len(rows),
        "prompts": total("prompts"),
        "observed": observed,
        "skipped": total("skipped"),
        "injected_files": total("injected_files"),
        "used_files": used,
        "wasted_files": total("wasted_files"),
        "extra_files": total("extra_files"),
        "tokens": total("tokens"),
        "hit_rate": (total("hits") / observed) if observed else 0.0,
        "precision": (used / injected_observed) if injected_observed else 0.0,
        "extra_per_prompt": (total("extra_files") / observed) if observed else 0.0,
    }


STAGE_ORDER = ("skip", "sparse", "embed", "dense", "fuse", "score", "gate", "fallback", "assemble")


def probe(repo: str | None, prompt: str) -> dict[str, Any]:
    """Run a real request through the daemon and return the stage-by-stage breakdown."""
    root = _repo(repo)
    if not (prompt or "").strip():
        raise ApiError("prompt is required")

    from ..daemon import DaemonUnavailable, request

    try:
        response = request(
            {"op": "retrieve", "repo": str(root), "prompt": prompt}, timeout=30.0
        )
    except DaemonUnavailable as exc:
        raise ApiError(f"daemon not running: {exc}", 503) from exc
    if not response.get("ok"):
        raise ApiError(response.get("error", "retrieve failed"), 500)

    detail = None
    trace_id = response.get("trace_id") or 0
    if trace_id:
        conn = connect(root)
        try:
            row = trace.get(conn, trace_id)
            detail = asdict(row) if row else None
        finally:
            conn.close()

    return {
        "response": response,
        "trace": detail,
        "stages": _stage_view(response, detail, dense_note=_dense_note(root, response)),
    }


def _dense_note(root: Path, response: dict[str, Any]) -> str:
    """Say *why* dense retrieval did not run. 'unavailable' sends people hunting."""
    if response.get("dense_used"):
        return "on"
    conn = connect(root)
    try:
        stored = dense_config(conn)
        pending = conn.execute("SELECT COUNT(*) FROM files WHERE dense_ready = 0").fetchone()[0]
    finally:
        conn.close()
    if stored is None:
        return "no embeddings built: run `hybrid-retrieval embed`"

    loaded = daemon_health().get("embedder")
    if loaded and loaded != stored[0]:
        return f"index built with {stored[0]}, daemon loaded {loaded}: reindex or align the config"
    if pending:
        return f"{pending} files still pending embedding"
    return "off"


def _stage_view(
    response: dict[str, Any], detail: dict[str, Any] | None, *, dense_note: str = ""
) -> list[dict[str, Any]]:
    """One card per pipeline stage: did it run, how long, and what did it produce."""
    stage_ms = response.get("stage_ms") or {}
    stages_meta = (detail or {}).get("stages") or {}
    skipped = bool((detail or {}).get("skipped"))

    def card(key: str, label: str, ran: bool, detail_text: str) -> dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "ran": ran,
            "ms": stage_ms.get(key),
            "detail": detail_text,
        }

    n_fused = stages_meta.get("n_fused", 0)
    gate = stages_meta.get("gate") or {}
    cards = [
        card(
            "skip",
            "Skip rule",
            True,
            (detail or {}).get("skip_reason") or "passed" if not skipped else
            f"skipped: {(detail or {}).get('skip_reason')}",
        ),
        card("sparse", "BM25 + FTS5", "sparse" in stage_ms, f"{n_fused} candidates after fusion"),
        card(
            "dense",
            "Dense (vectors)",
            bool(response.get("dense_used")),
            dense_note or ("on" if response.get("dense_used") else "off"),
        ),
        card("fuse", "RRF fusion", "fuse" in stage_ms, f"cut to {n_fused}"),
        card(
            "score",
            "Learned reranker",
            bool(response.get("reranked")),
            "reranked" if response.get("reranked") else "no model loaded",
        ),
        card(
            "gate",
            "Confidence gate",
            bool(gate),
            f"{gate.get('decision', 'n/a')} top={gate.get('top_score')} "
            f"margin={gate.get('boundary_margin')}"
            if gate
            else "no gate without a ranker",
        ),
        card(
            "fallback",
            "ripgrep fallback",
            bool(response.get("fell_back")),
            "replaced the ranking" if response.get("fell_back") else "not needed",
        ),
        card(
            "assemble",
            "Context assembly",
            "assemble" in stage_ms,
            f"{len(response.get('paths') or [])} files, {response.get('tokens', 0)} tokens",
        ),
    ]
    return cards
