"""Per-query tracing (decision 32).

Every request writes one row: what was asked, what each stage produced, what the gate decided, how
long it took, and what was ultimately injected. Three things depend on this existing:

  * debugging a bad ranking without re-running the query by hand;
  * the eval harness, which needs to know what the pipeline actually did;
  * implicit-feedback training later, which joins injected files against the files the agent went
    on to read or edit.

Skipped prompts are traced too. "The hook did nothing" and "the hook was never called" look
identical from the outside, and only one of them is a bug.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any

RETENTION_DAYS = 30


@dataclass(frozen=True, slots=True)
class TraceRow:
    id: int
    ts: float
    prompt: str
    skipped: bool
    skip_reason: str
    decision: str
    latency_ms: float
    injected_tokens: int
    # Written since the first version, read back only once feedback.py needed it to pair a trace
    # with the session turn that followed. Defaulted and placed last of the required fields so
    # existing positional construction keeps working.
    session_id: str = ""
    stages: dict[str, Any] = field(default_factory=dict)
    selected: list[dict] = field(default_factory=list)

    @property
    def paths(self) -> list[str]:
        return [entry.get("path", "") for entry in self.selected]


def record(
    conn: sqlite3.Connection,
    *,
    prompt: str,
    result,
    session_id: str | None = None,
) -> int:
    """Persist a RetrievalResult. Never raises: a failed trace must not fail the request."""
    try:
        context = getattr(result, "context", None)
        stages = {
            "stage_ms": {k: round(v, 2) for k, v in (result.stage_ms or {}).items()},
            "dense_used": result.dense_used,
            "reranked": result.reranked,
            "fell_back": result.fell_back,
            "n_fused": len(result.fused),
        }
        if result.gate is not None:
            stages["gate"] = {
                "decision": result.gate.decision,
                "top_score": round(result.gate.top_score, 4),
                "boundary_margin": (
                    None
                    if result.gate.boundary_margin == float("inf")
                    else round(result.gate.boundary_margin, 4)
                ),
            }
        selected = [
            {
                "path": c.path,
                "model_score": round(c.model_score, 4),
                "rrf": round(c.rrf_score, 5),
                "dense_rank": c.dense_rank,
                "sparse_rank": c.sparse_rank,
                "ast_hops": c.ast_hops,
            }
            for c in result.selected
        ]
        cursor = conn.execute(
            "INSERT INTO traces(ts, session_id, prompt, skipped, skip_reason, decision, "
            "latency_ms, injected_tokens, stages, selected) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(),
                session_id,
                prompt,
                1 if result.was_skipped else 0,
                result.skipped or None,
                (result.gate.decision if result.gate else None),
                round(result.latency_ms, 2),
                context.tokens if context else 0,
                json.dumps(stages),
                json.dumps(selected),
            ),
        )
        return int(cursor.lastrowid or 0)
    except sqlite3.Error:
        return 0


def _row(raw: sqlite3.Row) -> TraceRow:
    return TraceRow(
        id=raw["id"],
        ts=raw["ts"],
        prompt=raw["prompt"],
        skipped=bool(raw["skipped"]),
        skip_reason=raw["skip_reason"] or "",
        decision=raw["decision"] or "",
        latency_ms=raw["latency_ms"] or 0.0,
        injected_tokens=raw["injected_tokens"] or 0,
        session_id=raw["session_id"] or "",
        stages=json.loads(raw["stages"] or "{}"),
        selected=json.loads(raw["selected"] or "[]"),
    )


def recent(conn: sqlite3.Connection, *, limit: int = 10) -> list[TraceRow]:
    rows = conn.execute(
        "SELECT * FROM traces ORDER BY ts DESC LIMIT ?", (limit,)
    ).fetchall()
    return [_row(r) for r in rows]


def get(conn: sqlite3.Connection, trace_id: int) -> TraceRow | None:
    raw = conn.execute("SELECT * FROM traces WHERE id = ?", (trace_id,)).fetchone()
    return _row(raw) if raw else None


def prune(conn: sqlite3.Connection, *, days: int = RETENTION_DAYS) -> int:
    cutoff = time.time() - days * 86400
    cursor = conn.execute("DELETE FROM traces WHERE ts < ?", (cutoff,))
    return cursor.rowcount or 0


def record_feedback(
    conn: sqlite3.Connection, trace_id: int, *, read: list[str], edited: list[str]
) -> None:
    """What the agent went on to touch. Joined against `selected` this gives real precision."""
    conn.execute(
        "INSERT INTO feedback(trace_id, read_paths, edited_paths, observed_at) "
        "VALUES(?,?,?,?) ON CONFLICT(trace_id) DO UPDATE SET "
        "read_paths = excluded.read_paths, edited_paths = excluded.edited_paths, "
        "observed_at = excluded.observed_at",
        (trace_id, json.dumps(read), json.dumps(edited), time.time()),
    )
