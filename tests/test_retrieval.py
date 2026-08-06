"""Sparse retrieval, fusion and assembly. No model required."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.config import Config
from hybrid_retrieval.db import connect
from hybrid_retrieval.index import index_repo
from hybrid_retrieval.retrieve import (
    assemble,
    bm25_files,
    expand_by_ast,
    retrieve,
    rrf_fuse,
    sparse_candidates,
)
from hybrid_retrieval.text import identifier_text, query_terms, split_identifier
from hybrid_retrieval.types import Candidate

JWT = """using System;

namespace Api.Auth;

public class JwtService
{
    public string RotateRefreshToken(string token) => token;
}
"""

CONTROLLER = """using Api.Auth;

namespace Api.Controllers;

public class AuthController
{
    public string Login(string user) => user;
}
"""

UNRELATED = """namespace Api.Billing;

public class InvoiceRenderer
{
    public string Render(int id) => id.ToString();
}
"""


@pytest.fixture
def indexed(git_repo: Path) -> tuple[Path, sqlite3.Connection]:
    write(git_repo, "src/JwtService.cs", JWT)
    write(git_repo, "src/AuthController.cs", CONTROLLER)
    write(git_repo, "src/InvoiceRenderer.cs", UNRELATED)
    conn = connect(git_repo)
    index_repo(git_repo, conn=conn)
    yield git_repo, conn
    conn.close()


# -- text normalisation -----------------------------------------------------


@pytest.mark.parametrize(
    ("word", "expected"),
    [
        ("RotateRefreshToken", ["rotate", "refresh", "token"]),
        ("rotate_refresh_token", ["rotate", "refresh", "token"]),
        ("JWTService", ["jwt", "service"]),
        ("parseHTTPResponse", ["parse", "http", "response"]),
        ("simple", ["simple"]),
        ("_private", ["private"]),
    ],
)
def test_split_identifier(word: str, expected: list[str]):
    assert split_identifier(word) == expected


def test_identifier_text_only_emits_compounds():
    assert identifier_text("var refreshToken = 1;") == "refresh token"


def test_query_terms_drop_stopwords_and_keep_identifiers():
    terms = query_terms("Add JWT refresh token rotation to the AuthController")
    assert "jwt" in terms
    assert "refresh" in terms
    assert "authcontroller" in terms
    assert "controller" in terms, "compound is split as well as kept whole"
    assert "add" not in terms and "the" not in terms


# -- BM25 -------------------------------------------------------------------


def test_bm25_finds_the_right_file(indexed):
    _, conn = indexed
    scores = bm25_files(conn, "rotate refresh token", limit=10)
    assert scores
    assert max(scores, key=scores.get) == "src/JwtService.cs"


def test_compound_identifier_is_reachable_by_its_parts(indexed):
    """The diagram's own example: 'refresh token' must find RotateRefreshToken."""
    _, conn = indexed
    assert "src/JwtService.cs" in bm25_files(conn, "refresh token rotation", limit=10)


def test_prompt_with_no_usable_terms_returns_nothing(indexed):
    _, conn = indexed
    assert bm25_files(conn, "the and of", limit=10) == {}


def test_punctuation_cannot_break_the_match_query(indexed):
    _, conn = indexed
    bm25_files(conn, 'fix "quote" AND (paren) NEAR/2 -dash*', limit=10)  # must not raise


# -- AST expansion ----------------------------------------------------------


def test_ast_expansion_reaches_importers(indexed):
    _, conn = indexed
    reached = expand_by_ast(conn, {"src/JwtService.cs": 1.0}, depth=2)
    assert "src/JwtService.cs" in reached
    assert reached["src/JwtService.cs"][1] == 0, "seed is at hop 0"


def test_ast_expansion_scores_decay_with_distance(indexed):
    _, conn = indexed
    reached = expand_by_ast(conn, {"src/AuthController.cs": 1.0}, depth=2)
    neighbour = reached.get("src/JwtService.cs")
    assert neighbour is not None, "using edge should be traversed"
    assert neighbour[1] == 1
    assert neighbour[0] < 1.0, "neighbours rank below direct hits"


def test_ast_depth_zero_disables_expansion(indexed):
    _, conn = indexed
    candidates = sparse_candidates(conn, "login user", limit=10, ast_depth=0)
    assert all(c.ast_hops == 0 for c in candidates)


def test_unrelated_file_is_not_pulled_in(indexed):
    _, conn = indexed
    paths = {c.path for c in sparse_candidates(conn, "refresh token", limit=10)}
    assert "src/InvoiceRenderer.cs" not in paths


# -- fusion -----------------------------------------------------------------


def test_rrf_rewards_agreement_between_lists():
    dense = [Candidate(path="a.cs", dense_rank=0), Candidate(path="b.cs", dense_rank=1)]
    sparse = [Candidate(path="b.cs", sparse_rank=0), Candidate(path="c.cs", sparse_rank=1)]
    fused = rrf_fuse(dense, sparse, k=60, limit=10)
    assert fused[0].path == "b.cs", "ranked by both lists beats top of one"
    assert {c.path for c in fused} == {"a.cs", "b.cs", "c.cs"}


def test_rrf_preserves_both_scores_after_merge():
    dense = [Candidate(path="a.cs", dense_rank=0, dense_score=0.9)]
    sparse = [Candidate(path="a.cs", sparse_rank=0, sparse_score=3.2, ast_hops=1)]
    (merged,) = rrf_fuse(dense, sparse, limit=10)
    assert merged.dense_score == 0.9
    assert merged.sparse_score == 3.2
    assert merged.ast_hops == 1


def test_rrf_applies_the_cut():
    dense = [Candidate(path=f"{i}.cs", dense_rank=i) for i in range(80)]
    assert len(rrf_fuse(dense, [], limit=50)) == 50, "the diagram's 100-of-100 is a no-op"


def test_rrf_is_deterministic_on_ties():
    dense = [Candidate(path="b.cs", dense_rank=0), Candidate(path="a.cs", dense_rank=0)]
    assert [c.path for c in rrf_fuse(dense, [], limit=10)] == ["a.cs", "b.cs"]


# -- assembly ---------------------------------------------------------------


def test_assemble_emits_full_file_contents(indexed):
    repo, _ = indexed
    pack = assemble(repo, [Candidate(path="src/JwtService.cs")], top_n=5)
    assert "RotateRefreshToken" in pack.text
    assert "--- src/JwtService.cs ---" in pack.text
    assert pack.paths == ["src/JwtService.cs"]
    assert pack.tokens > 0


def test_assemble_is_uncapped_by_default(indexed):
    repo, _ = indexed
    candidates = [
        Candidate(path="src/JwtService.cs"),
        Candidate(path="src/AuthController.cs"),
        Candidate(path="src/InvoiceRenderer.cs"),
    ]
    pack = assemble(repo, candidates, top_n=5, max_tokens=None)
    assert len(pack.paths) == 3
    assert pack.dropped == []


def test_assemble_respects_a_configured_cap(indexed):
    repo, _ = indexed
    candidates = [
        Candidate(path="src/JwtService.cs"),
        Candidate(path="src/AuthController.cs"),
        Candidate(path="src/InvoiceRenderer.cs"),
    ]
    pack = assemble(repo, candidates, top_n=5, max_tokens=30)
    assert len(pack.paths) == 1, "whole files only, never truncated mid-file"
    assert len(pack.dropped) == 2


def test_assemble_skips_files_that_vanished(indexed):
    repo, _ = indexed
    pack = assemble(repo, [Candidate(path="src/Gone.cs")], top_n=5)
    assert pack.is_empty
    assert pack.dropped == ["src/Gone.cs"]


# -- end to end (sparse only) -----------------------------------------------


def test_pipeline_without_embedder_still_retrieves(indexed):
    repo, conn = indexed
    result = retrieve(repo, "rotate the refresh token", conn=conn, cfg=Config())
    assert result.dense_used is False, "no embedder, so sparse only"
    assert result.paths[0] == "src/JwtService.cs"
    assert "RotateRefreshToken" in result.context.text
    assert result.latency_ms >= 0
    assert set(result.stage_ms) >= {"sparse", "fuse", "assemble"}


def test_pipeline_honours_top_n(indexed):
    repo, conn = indexed
    cfg = Config()
    cfg.top_n = 1
    result = retrieve(repo, "refresh token login", conn=conn, cfg=cfg)
    assert len(result.paths) == 1


def test_pipeline_on_empty_index_returns_empty_context(git_repo: Path):
    conn = connect(git_repo)
    try:
        result = retrieve(git_repo, "anything at all", conn=conn, cfg=Config())
        assert result.paths == []
        assert result.context.is_empty
    finally:
        conn.close()
