"""Implicit feedback: pairing a trace with the session turn that followed it."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from hybrid_retrieval import feedback
from hybrid_retrieval.db import connect
from hybrid_retrieval.sessions import SessionExample


@pytest.fixture
def conn(git_repo: Path) -> sqlite3.Connection:
    handle = connect(git_repo)
    yield handle
    handle.close()


def _trace(
    conn: sqlite3.Connection,
    *,
    prompt: str,
    paths: tuple[str, ...] = (),
    session_id: str = "",
    ts: float = 1_000.0,
    skipped: bool = False,
    tokens: int = 120,
) -> int:
    selected = json.dumps(
        [
            {
                "path": p,
                "model_score": 0.5,
                "rrf": 0.1,
                "dense_rank": None,
                "sparse_rank": i,
                "ast_hops": 0,
            }
            for i, p in enumerate(paths)
        ]
    )
    cursor = conn.execute(
        "INSERT INTO traces(ts, session_id, prompt, skipped, skip_reason, decision, latency_ms, "
        "injected_tokens, stages, selected) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (
            ts,
            session_id,
            prompt,
            1 if skipped else 0,
            "only 1 usable search term(s)" if skipped else None,
            None if skipped else "HIGH",
            4.5,
            tokens,
            "{}",
            selected,
        ),
    )
    conn.commit()
    return int(cursor.lastrowid or 0)


def _example(
    prompt: str,
    *,
    read: tuple[str, ...] = (),
    edited: tuple[str, ...] = (),
    ts: int = 1_000,
    session_id: str = "",
) -> SessionExample:
    return SessionExample(
        prompt=prompt,
        repo=Path("/repo"),
        read_paths=frozenset(read),
        edited_paths=frozenset(edited),
        timestamp=ts,
        session_id=session_id,
        source="claude-code",
    )


# -- matching ---------------------------------------------------------------


def test_session_id_and_prompt_is_an_exact_match(conn):
    _trace(conn, prompt="fix the refresh token rotation", session_id="s1", ts=1_000)
    rows = feedback.trace.recent(conn)
    matched = feedback.match_examples(
        rows, [_example("fix the refresh token rotation", session_id="s1", ts=1_000)]
    )
    assert len(matched) == 1


def test_whitespace_differences_do_not_lose_the_match(conn):
    _trace(conn, prompt="fix  the\nrefresh token", session_id="s1")
    rows = feedback.trace.recent(conn)
    matched = feedback.match_examples(rows, [_example("fix the refresh token", session_id="s1")])
    assert len(matched) == 1


def test_a_trace_without_a_session_id_matches_on_prompt_and_time(conn):
    _trace(conn, prompt="where is the gate calibrated", ts=1_000)
    rows = feedback.trace.recent(conn)
    matched = feedback.match_examples(rows, [_example("where is the gate calibrated", ts=1_030)])
    assert len(matched) == 1


def test_the_same_prompt_far_apart_in_time_is_not_matched(conn):
    _trace(conn, prompt="where is the gate calibrated", ts=1_000)
    rows = feedback.trace.recent(conn)
    matched = feedback.match_examples(
        rows, [_example("where is the gate calibrated", ts=1_000 + feedback.MATCH_WINDOW_S + 60)]
    )
    assert matched == {}


def test_a_repeated_prompt_pairs_with_the_nearest_turn(conn):
    trace_id = _trace(conn, prompt="run the tests again please", ts=5_000)
    rows = feedback.trace.recent(conn)
    near = _example("run the tests again please", read=("b.py",), ts=5_010)
    far = _example("run the tests again please", read=("a.py",), ts=4_900)
    matched = feedback.match_examples(rows, [far, near])
    assert matched[trace_id].read_paths == frozenset({"b.py"})


def test_an_unmatched_trace_is_absent_rather_than_empty(conn):
    _trace(conn, prompt="something nobody ever answered")
    rows = feedback.trace.recent(conn)
    assert feedback.match_examples(rows, []) == {}


# -- the set arithmetic -----------------------------------------------------


def test_used_wasted_and_extra_partition_the_files(conn):
    _trace(
        conn,
        prompt="add jitter to the retry backoff",
        paths=("retry.py", "unused.py"),
        session_id="s1",
    )
    feedback.reconcile(
        "/repo",
        conn,
        examples=[
            _example(
                "add jitter to the retry backoff",
                read=("retry.py", "http.py"),
                edited=("client.py",),
                session_id="s1",
            )
        ],
    )
    [outcome] = feedback.outcomes(conn)
    assert outcome.used == ["retry.py"]
    assert outcome.wasted == ["unused.py"]
    assert outcome.extra == ["client.py", "http.py"]
    assert outcome.hit is True
    assert outcome.precision == 0.5


def test_an_unobserved_trace_is_not_reported_as_a_miss(conn):
    _trace(conn, prompt="a prompt with no transcript behind it", paths=("a.py",))
    [outcome] = feedback.outcomes(conn)
    assert outcome.observed is False
    assert outcome.hit is False
    assert outcome.extra == []


def test_a_skipped_prompt_still_shows_what_the_agent_had_to_read(conn):
    """The cost of skipping is exactly the files the agent then opened unaided."""
    _trace(conn, prompt="ok now wire it up", paths=(), session_id="s1", skipped=True, tokens=0)
    feedback.reconcile(
        "/repo",
        conn,
        examples=[_example("ok now wire it up", read=("a.py", "b.py"), session_id="s1")],
    )
    [outcome] = feedback.outcomes(conn)
    assert outcome.skipped is True
    assert outcome.injected == []
    assert outcome.extra == ["a.py", "b.py"]
    assert outcome.precision == 0.0


def test_reconcile_is_idempotent(conn):
    _trace(conn, prompt="index the walker properly", paths=("walker.py",), session_id="s1")
    examples = [_example("index the walker properly", read=("walker.py",), session_id="s1")]
    first = feedback.reconcile("/repo", conn, examples=examples)
    second = feedback.reconcile("/repo", conn, examples=examples)
    assert first["matched"] == second["matched"] == 1
    assert conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 1


def test_reconcile_updates_a_row_as_the_session_grows(conn):
    _trace(conn, prompt="keep reading files as we go", paths=("a.py",), session_id="s1")
    feedback.reconcile(
        "/repo",
        conn,
        examples=[_example("keep reading files as we go", read=("a.py",), session_id="s1")],
    )
    feedback.reconcile(
        "/repo",
        conn,
        examples=[
            _example("keep reading files as we go", read=("a.py", "later.py"), session_id="s1")
        ],
    )
    [outcome] = feedback.outcomes(conn)
    assert outcome.extra == ["later.py"]


# -- grouping ---------------------------------------------------------------


def test_by_session_groups_and_aggregates(conn):
    _trace(conn, prompt="first prompt about the ranker", paths=("a.py",), session_id="s1", ts=10)
    _trace(conn, prompt="second prompt about the gate", paths=("b.py",), session_id="s1", ts=20)
    _trace(conn, prompt="a prompt in another session", paths=("c.py",), session_id="s2", ts=30)
    feedback.reconcile(
        "/repo",
        conn,
        examples=[
            _example("first prompt about the ranker", read=("a.py",), session_id="s1", ts=10),
            _example("second prompt about the gate", read=("z.py",), session_id="s1", ts=20),
            _example("a prompt in another session", read=("c.py",), session_id="s2", ts=30),
        ],
    )
    sessions = feedback.by_session(conn)
    assert [s["session_id"] for s in sessions] == ["s2", "s1"]  # newest session first
    s1 = next(s for s in sessions if s["session_id"] == "s1")
    assert s1["prompts"] == 2
    assert s1["used_files"] == 1
    assert s1["wasted_files"] == 1
    assert s1["extra_files"] == 1
    assert s1["precision"] == 0.5


def test_turns_within_a_session_are_newest_first(conn):
    _trace(conn, prompt="the older prompt in this session", session_id="s1", ts=10)
    _trace(conn, prompt="the newer prompt in this session", session_id="s1", ts=20)
    [session] = feedback.by_session(conn)
    assert session["outcomes"][0]["prompt"] == "the newer prompt in this session"


def test_traces_without_a_session_id_are_kept_in_one_group(conn):
    _trace(conn, prompt="a dashboard probe, no session", ts=10)
    _trace(conn, prompt="a cli query, also no session", ts=20)
    [session] = feedback.by_session(conn)
    assert session["session_id"] == ""
    assert session["label"] == "no session id"
    assert session["prompts"] == 2


def test_precision_ignores_unobserved_prompts(conn):
    """One perfect observed prompt plus one unobserved one is 100%, not 50%."""
    _trace(conn, prompt="the observed prompt about auth", paths=("a.py",), session_id="s1", ts=10)
    _trace(conn, prompt="the unobserved prompt about auth", paths=("b.py",), session_id="s1", ts=20)
    feedback.reconcile(
        "/repo",
        conn,
        examples=[
            _example("the observed prompt about auth", read=("a.py",), session_id="s1", ts=10)
        ],
    )
    [session] = feedback.by_session(conn)
    assert session["observed"] == 1
    assert session["precision"] == 1.0


def test_empty_database_produces_no_sessions(conn):
    assert feedback.by_session(conn) == []
    assert feedback.outcomes(conn) == []


# -- dashboard endpoint -----------------------------------------------------


def test_sessions_endpoint_reports_totals(git_repo: Path):
    """refresh=False so the endpoint never mines the developer's real session history."""
    from hybrid_retrieval.dashboard import api

    handle = connect(git_repo)
    try:
        _trace(handle, prompt="a prompt worth reconciling", paths=("a.py", "b.py"), session_id="s1")
        feedback.reconcile(
            git_repo,
            handle,
            examples=[
                _example("a prompt worth reconciling", read=("a.py", "c.py"), session_id="s1")
            ],
        )
    finally:
        handle.close()

    payload = api.sessions(str(git_repo), refresh=False)
    totals = payload["totals"]
    assert totals["sessions"] == 1
    assert totals["injected_files"] == 2
    assert totals["used_files"] == 1
    assert totals["wasted_files"] == 1
    assert totals["extra_files"] == 1
    assert totals["precision"] == 0.5
    assert totals["hit_rate"] == 1.0


def test_sessions_endpoint_pages_without_moving_totals(git_repo: Path):
    """Paging slices the list only: the headline numbers cover the whole window."""
    from hybrid_retrieval.dashboard import api

    handle = connect(git_repo)
    try:
        for i in range(5):
            _trace(handle, prompt=f"prompt {i}", paths=("a.py",), session_id=f"s{i}", ts=1_000.0 + i)
    finally:
        handle.close()

    first = api.sessions(str(git_repo), refresh=False, page=1, page_size=2)
    assert first["total"] == 5
    assert first["pages"] == 3
    assert first["page"] == 1
    assert [s["session_id"] for s in first["sessions"]] == ["s4", "s3"]  # newest first

    last = api.sessions(str(git_repo), refresh=False, page=3, page_size=2)
    assert [s["session_id"] for s in last["sessions"]] == ["s0"]
    assert last["totals"] == first["totals"]

    # Out-of-range pages clamp instead of returning an empty list.
    assert api.sessions(str(git_repo), refresh=False, page=99, page_size=2)["page"] == 3
    assert api.sessions(str(git_repo), refresh=False, page=0, page_size=2)["page"] == 1
