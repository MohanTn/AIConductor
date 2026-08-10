"""Implicit feedback: what the pipeline injected, against what the agent then opened.

Decision 32 recorded a trace per request so that this join could exist later. A trace says what was
pushed into context for a prompt; a session transcript says which files the agent went on to read
or edit for that same prompt. Overlapping the two turns every real prompt into a labelled example
that nobody had to write:

    used   = injected AND touched     the injection paid for itself
    wasted = injected MINUS touched   tokens spent on files nobody opened
    extra  = touched MINUS injected   what retrieval missed and the agent had to find itself

``extra`` is the number that matters, and it is the one the dashboard leads with. Every file in it
is a discovery round-trip the injection was supposed to have saved. ``wasted`` is the other half of
the same bill: §10i measured that an oversized payload costs more than the discovery it replaces,
so a file injected and never opened is not free, it is the thing that loses the money.

**Correlation, not causation.** A file in ``used`` was opened by the agent *after* we injected it.
Whether it was opened *because* we injected it, or would have been found anyway, is not knowable
from a transcript. These numbers rank prompts for inspection and train a ranker; they are not an
A/B result. `bench/tier2_runner.py` is what measures causation.

**Unobserved is not the same as perfect.** A prompt where the agent opened no files at all yields
no session example (`sessions.base.make_example` drops examples with nothing touched), so it lands
here as *unobserved* rather than as a flawless injection. That biases the visible numbers
pessimistically. Distinguishing the two needs a second parse of the transcript that keeps empty
turns, which is not worth a schema change until the loop is actually training on this.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import trace
from .sessions import SessionExample, group_by_repo, mine

# A trace is written when the hook fires; the transcript timestamps the user record that triggered
# it. They describe the same instant, so this window only has to absorb clock skew and the
# transcript's second-level rounding. Wide enough to be forgiving, far too narrow to pair a prompt
# with a different one.
MATCH_WINDOW_S = 120.0

DEFAULT_LIMIT = 200


@dataclass(frozen=True, slots=True)
class Outcome:
    """One prompt: what went in, what the agent did next."""

    trace_id: int
    ts: float
    session_id: str
    prompt: str
    skipped: bool = False
    skip_reason: str = ""
    decision: str = ""
    injected_tokens: int = 0
    latency_ms: float = 0.0
    injected: list[str] = field(default_factory=list)
    used: list[str] = field(default_factory=list)
    wasted: list[str] = field(default_factory=list)
    extra: list[str] = field(default_factory=list)
    edited: list[str] = field(default_factory=list)
    observed: bool = False

    @property
    def hit(self) -> bool:
        """Did the injection contain at least one file the agent actually opened?"""
        return bool(self.used)

    @property
    def precision(self) -> float:
        return len(self.used) / len(self.injected) if self.injected else 0.0

    @property
    def recall(self) -> float:
        touched = len(self.used) + len(self.extra)
        return len(self.used) / touched if touched else 0.0


def _normalise(prompt: str) -> str:
    """Whitespace-insensitive prompt key.

    The hook receives the prompt as typed; the transcript stores it after its own newline handling.
    Comparing raw text loses matches to a trailing newline, which is a silent and very confusing
    way for the whole join to return nothing.
    """
    return " ".join((prompt or "").split())


def match_examples(
    rows: list[trace.TraceRow], examples: list[SessionExample]
) -> dict[int, SessionExample]:
    """Pair each trace with the session turn it belongs to. Returns trace id -> example.

    Session id plus prompt is an exact key and is tried first. Prompt plus a time window is the
    fallback for traces written without a session id, which is every request that did not come from
    the hook (the dashboard probe, the CLI). Unmatched traces are simply absent: an unobserved
    prompt must not be reported as a zero-hit one.
    """
    by_session: dict[tuple[str, str], list[SessionExample]] = {}
    by_prompt: dict[str, list[SessionExample]] = {}
    for example in examples:
        key = _normalise(example.prompt)
        by_session.setdefault((example.session_id, key), []).append(example)
        by_prompt.setdefault(key, []).append(example)

    matched: dict[int, SessionExample] = {}
    for row in rows:
        key = _normalise(row.prompt)
        exact = by_session.get((row.session_id or "", key)) if row.session_id else None
        if exact:
            # Same session, same text: the only ambiguity left is the same prompt typed twice.
            matched[row.id] = min(exact, key=lambda e: abs(e.timestamp - row.ts))
            continue
        loose = by_prompt.get(key)
        if not loose:
            continue
        best = min(loose, key=lambda e: abs(e.timestamp - row.ts))
        if abs(best.timestamp - row.ts) <= MATCH_WINDOW_S:
            matched[row.id] = best
    return matched


def reconcile(
    repo_root: Path | str,
    conn: sqlite3.Connection,
    *,
    examples: list[SessionExample] | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, int]:
    """Mine session history for this repo and persist the matches into `feedback`.

    Idempotent: `record_feedback` upserts, so re-running after more of a session has happened
    updates the row rather than duplicating it. That matters because a session is still being
    written while the dashboard is open.
    """
    root = Path(repo_root).expanduser().resolve()
    if examples is None:
        try:
            examples = group_by_repo(mine()).get(root, [])
        except Exception:  # noqa: BLE001 - third-party on-disk formats, never fatal here
            examples = []

    rows = trace.recent(conn, limit=limit)
    matched = match_examples(rows, examples)
    for trace_id, example in matched.items():
        trace.record_feedback(
            conn,
            trace_id,
            read=sorted(example.read_paths),
            edited=sorted(example.edited_paths),
        )
    conn.commit()
    return {"traces": len(rows), "examples": len(examples), "matched": len(matched)}


def _loads(raw: Any) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(v) for v in value] if isinstance(value, list) else []


def outcomes(conn: sqlite3.Connection, *, limit: int = DEFAULT_LIMIT) -> list[Outcome]:
    """Every recent trace with its observed follow-up, newest first."""
    rows = conn.execute(
        "SELECT t.id, t.ts, t.session_id, t.prompt, t.skipped, t.skip_reason, t.decision, "
        "       t.latency_ms, t.injected_tokens, t.selected, "
        "       f.read_paths, f.edited_paths, f.observed_at "
        "FROM traces t LEFT JOIN feedback f ON f.trace_id = t.id "
        "ORDER BY t.ts DESC LIMIT ?",
        (limit,),
    ).fetchall()

    out: list[Outcome] = []
    for row in rows:
        injected = [entry.get("path", "") for entry in _selected(row["selected"])]
        read, edited = _loads(row["read_paths"]), _loads(row["edited_paths"])
        touched = set(read) | set(edited)
        observed = row["observed_at"] is not None
        injected_set = set(injected)
        out.append(
            Outcome(
                trace_id=row["id"],
                ts=row["ts"],
                session_id=row["session_id"] or "",
                prompt=row["prompt"],
                skipped=bool(row["skipped"]),
                skip_reason=row["skip_reason"] or "",
                decision=row["decision"] or "",
                injected_tokens=row["injected_tokens"] or 0,
                latency_ms=row["latency_ms"] or 0.0,
                injected=injected,
                used=sorted(injected_set & touched),
                wasted=sorted(injected_set - touched),
                extra=sorted(touched - injected_set),
                edited=sorted(edited),
                observed=observed,
            )
        )
    return out


def _selected(raw: Any) -> list[dict]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def by_session(conn: sqlite3.Connection, *, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """Outcomes grouped into the sessions they came from, most recent session first.

    Traces with no session id are collected under a single synthetic group rather than dropped —
    they are real requests (dashboard probes, CLI queries) and hiding them makes the totals lie.
    """
    grouped: dict[str, list[Outcome]] = {}
    for outcome in outcomes(conn, limit=limit):
        grouped.setdefault(outcome.session_id, []).append(outcome)

    sessions = []
    for session_id, items in grouped.items():
        items.sort(key=lambda o: o.ts)
        observed = [o for o in items if o.observed]
        injected = sum(len(o.injected) for o in items)
        used = sum(len(o.used) for o in observed)
        sessions.append(
            {
                "session_id": session_id,
                "label": session_id[:8] if session_id else "no session id",
                "started": items[0].ts,
                "ended": items[-1].ts,
                "prompts": len(items),
                "observed": len(observed),
                "skipped": sum(1 for o in items if o.skipped),
                "injected_files": injected,
                "used_files": used,
                "wasted_files": sum(len(o.wasted) for o in observed),
                "extra_files": sum(len(o.extra) for o in observed),
                "tokens": sum(o.injected_tokens for o in items),
                "hits": sum(1 for o in observed if o.hit),
                # Over observed prompts only: an unobserved prompt has no precision, and counting
                # it as zero would make a quiet session look like a failing one.
                "precision": (
                    sum(len(o.used) for o in observed)
                    / sum(len(o.injected) for o in observed)
                    if any(o.injected for o in observed)
                    else 0.0
                ),
                "outcomes": [_as_json(o) for o in reversed(items)],
            }
        )
    sessions.sort(key=lambda s: s["ended"], reverse=True)
    return sessions


def _as_json(outcome: Outcome) -> dict[str, Any]:
    return {
        "trace_id": outcome.trace_id,
        "ts": outcome.ts,
        "prompt": outcome.prompt,
        "skipped": outcome.skipped,
        "skip_reason": outcome.skip_reason,
        "decision": outcome.decision,
        "injected_tokens": outcome.injected_tokens,
        "latency_ms": outcome.latency_ms,
        "injected": outcome.injected,
        "used": outcome.used,
        "wasted": outcome.wasted,
        "extra": outcome.extra,
        "edited": outcome.edited,
        "observed": outcome.observed,
        "hit": outcome.hit,
        "precision": round(outcome.precision, 3),
        "recall": round(outcome.recall, 3),
    }
