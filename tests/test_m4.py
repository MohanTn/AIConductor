"""Skip rules, ripgrep fallback, and tracing."""

from __future__ import annotations

import shutil
import sqlite3
import time
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval import trace
from hybrid_retrieval.config import Config, SkipConfig
from hybrid_retrieval.db import connect
from hybrid_retrieval.index import index_repo
from hybrid_retrieval.rank import GateThresholds, RankerArtefact
from hybrid_retrieval.retrieve import retrieve, ripgrep_candidates, ripgrep_paths, should_skip
from hybrid_retrieval.retrieve.pipeline import RetrievalResult
from hybrid_retrieval.types import Candidate

needs_rg = pytest.mark.skipif(shutil.which("rg") is None, reason="ripgrep not installed")

JWT = """namespace Api.Auth;

public class JwtService
{
    public string RotateRefreshToken(string token) => token;
}
"""


@pytest.fixture
def indexed(git_repo: Path) -> tuple[Path, sqlite3.Connection]:
    write(git_repo, "src/JwtService.cs", JWT)
    write(git_repo, "src/Unrelated.cs", "namespace Api.Billing;\npublic class Invoice { }\n")
    conn = connect(git_repo)
    index_repo(git_repo, conn=conn)
    yield git_repo, conn
    conn.close()


# -- skip rules -------------------------------------------------------------


@pytest.mark.parametrize(
    "prompt",
    [
        "add jwt refresh token rotation to the auth controller",
        "fix JWT refresh bug",  # short but full of identifiers
        "why is CircuitBreaker stuck open",
    ],
)
def test_real_prompts_are_not_skipped(prompt: str):
    assert not should_skip(prompt).skip, prompt


@pytest.mark.parametrize(
    ("prompt", "fragment"),
    [
        ("", "empty"),
        ("yes", "matched"),
        ("ok go on", "matched"),
        ("/clear", "matched"),
        ("continue please", "matched"),
        ("why did you do that", "conversation"),
        ("thanks that is great", "matched"),
        ("could you please have another look at that", "usable search term"),
        ("hmm", "chars"),
    ],
)
def test_noise_is_skipped_with_a_reason(prompt: str, fragment: str):
    decision = should_skip(prompt)
    assert decision.skip, prompt
    assert fragment in decision.reason


def test_short_identifier_prompt_beats_long_vague_one():
    """Length is the wrong signal; usable search terms are the right one."""
    assert not should_skip("fix JwtService rotation").skip
    assert should_skip("could you please take another look at this for me").skip


def test_skip_threshold_is_configurable():
    cfg = SkipConfig(min_query_terms=5)
    assert should_skip("add jwt refresh rotation", cfg).skip


def test_a_broken_config_pattern_does_not_break_every_prompt():
    cfg = SkipConfig(patterns=["([unclosed"])
    assert not should_skip("add jwt refresh token rotation", cfg).skip


def test_pipeline_returns_early_when_skipped(indexed):
    repo, conn = indexed
    result = retrieve(repo, "yes", conn=conn, cfg=Config())
    assert result.was_skipped
    assert result.paths == []
    assert result.context.is_empty
    assert result.stage_ms == {}, "a skipped prompt must not touch retrieval at all"


def test_skip_can_be_disabled(indexed):
    repo, conn = indexed
    result = retrieve(repo, "yes ok", conn=conn, cfg=Config(), apply_skip=False)
    assert not result.was_skipped


# -- ripgrep fallback -------------------------------------------------------


@needs_rg
def test_ripgrep_finds_files_by_identifier(indexed):
    repo, _ = indexed
    paths = ripgrep_paths(repo, "RotateRefreshToken", limit=10)
    assert "src/JwtService.cs" in paths


@needs_rg
def test_ripgrep_respects_the_allowed_set(indexed):
    repo, _ = indexed
    assert ripgrep_paths(repo, "RotateRefreshToken", limit=10, allowed={"src/Unrelated.cs"}) == []


@needs_rg
def test_ripgrep_candidates_are_ordered_and_scored(indexed):
    repo, _ = indexed
    candidates = ripgrep_candidates(repo, "rotate refresh token", limit=10)
    assert candidates
    scores = [c.model_score for c in candidates]
    assert scores == sorted(scores, reverse=True), "gate margin logic needs a descending order"


def test_ripgrep_with_no_usable_terms_returns_nothing(indexed):
    repo, _ = indexed
    assert ripgrep_paths(repo, "a of the", limit=10) == []


@needs_rg
def test_low_confidence_replaces_the_ranking(indexed):
    """Decision 28: LOW does not blend, it substitutes."""
    repo, conn = indexed

    class AlwaysLowRanker:
        artefact = RankerArtefact(gate=GateThresholds(min_top_score=1e9).to_dict())

        def rerank(self, candidates, matrix):
            return [
                Candidate(path=c.path, model_score=0.0, sparse_rank=i)
                for i, c in enumerate(candidates)
            ]

    result = retrieve(
        repo, "RotateRefreshToken rotation", conn=conn, cfg=Config(), ranker=AlwaysLowRanker()
    )
    assert result.gate is not None and not result.gate.is_high
    assert result.fell_back is True
    assert "fallback" in result.stage_ms


# -- tracing ----------------------------------------------------------------


def test_paths_only_skips_reading_the_files(indexed):
    """The hook renders the payload itself; assembling one it discards is pure waste."""
    repo, conn = indexed
    full = retrieve(repo, "rotate the refresh token", conn=conn, cfg=Config())
    lean = retrieve(
        repo, "rotate the refresh token", conn=conn, cfg=Config(), assemble_context=False
    )
    assert lean.paths == full.paths, "the ranking must be identical"
    assert lean.context.paths == full.paths, "callers still learn what was selected"
    assert lean.context.text == "" and full.context.text != ""
    assert "assemble" not in lean.stage_ms, "no assembly stage should have run"


def test_trace_records_a_normal_query(indexed):
    repo, conn = indexed
    result = retrieve(repo, "rotate the refresh token", conn=conn, cfg=Config())
    trace_id = trace.record(conn, prompt="rotate the refresh token", result=result, session_id="s1")
    assert trace_id > 0

    row = trace.get(conn, trace_id)
    assert row is not None
    assert row.prompt == "rotate the refresh token"
    assert row.skipped is False
    assert row.paths == result.paths
    assert "stage_ms" in row.stages
    assert row.stages["n_fused"] == len(result.fused)


def test_trace_records_skipped_prompts(indexed):
    """'The hook did nothing' and 'the hook never ran' must be distinguishable."""
    repo, conn = indexed
    result = retrieve(repo, "yes", conn=conn, cfg=Config())
    row = trace.get(conn, trace.record(conn, prompt="yes", result=result))
    assert row.skipped is True
    assert "matched" in row.skip_reason, "the trace must name which rule fired"


def test_trace_survives_a_write_failure(indexed):
    repo, conn = indexed
    result = retrieve(repo, "rotate the refresh token", conn=conn, cfg=Config())
    conn.execute("DROP TABLE traces")
    assert trace.record(conn, prompt="x", result=result) == 0, "tracing must never fail a request"


def test_recent_returns_newest_first(indexed):
    _, conn = indexed
    empty = RetrievalResult(skipped="test")
    for i in range(3):
        trace.record(conn, prompt=f"prompt number {i}", result=empty)
        time.sleep(0.01)
    rows = trace.recent(conn, limit=3)
    assert [r.prompt for r in rows] == ["prompt number 2", "prompt number 1", "prompt number 0"]


def test_prune_removes_only_expired_traces(indexed):
    _, conn = indexed
    trace.record(conn, prompt="recent prompt here", result=RetrievalResult(skipped="x"))
    conn.execute(
        "INSERT INTO traces(ts, prompt, skipped, latency_ms, injected_tokens) VALUES(?,?,?,?,?)",
        (time.time() - 60 * 86400, "ancient prompt", 1, 0, 0),
    )
    assert trace.prune(conn, days=30) == 1
    assert [r.prompt for r in trace.recent(conn, limit=5)] == ["recent prompt here"]


def test_stale_local_ranker_does_not_shadow_the_global_one(indexed, monkeypatch):
    """A stale repo model left the repo with no ranker at all, so test files filled the top 5."""
    from hybrid_retrieval import paths as app_paths
    from hybrid_retrieval.rank import Ranker, model_paths

    repo, _ = indexed
    local_model, local_meta = model_paths(repo)
    local_model.parent.mkdir(parents=True, exist_ok=True)
    local_model.write_text("not a model")
    local_meta.write_text(RankerArtefact(feature_names=("stale_feature",)).to_json())

    config_dir = repo / "fake-config"
    config_dir.mkdir()
    monkeypatch.setattr(app_paths, "config_dir", lambda: config_dir)
    assert Ranker.load(repo) is None, "an unusable local model must not raise"


def test_mismatched_embedder_degrades_to_sparse(indexed):
    """One daemon serves many repos; an index built with another model must not throw."""
    from hybrid_retrieval.db import ensure_vec_table, transaction
    from hybrid_retrieval.retrieve.pipeline import dense_is_ready

    repo, conn = indexed
    with transaction(conn):
        ensure_vec_table(conn, embedder_id="model/a", dim=768)
    conn.execute("UPDATE files SET dense_ready = 1")

    class Loaded:
        model_id = "model/b"
        dim = 1024

    assert dense_is_ready(conn) is True, "the index itself is ready"
    assert dense_is_ready(conn, Loaded()) is False, "but not for this model"

    result = retrieve(repo, "rotate the refresh token", conn=conn, cfg=Config(), embedder=Loaded())
    assert result.dense_used is False
    assert result.paths, "must still answer from sparse rather than fail"


def test_feedback_joins_to_a_trace(indexed):
    repo, conn = indexed
    result = retrieve(repo, "rotate the refresh token", conn=conn, cfg=Config())
    trace_id = trace.record(conn, prompt="rotate the refresh token", result=result)
    trace.record_feedback(conn, trace_id, read=["src/JwtService.cs"], edited=["src/Other.cs"])
    row = conn.execute(
        "SELECT read_paths, edited_paths FROM feedback WHERE trace_id = ?", (trace_id,)
    ).fetchone()
    assert "JwtService" in row[0]
    assert "Other" in row[1]
