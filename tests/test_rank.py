from __future__ import annotations

import sqlite3
import subprocess
from pathlib import Path

import numpy as np
import pytest

from conftest import write
from hybrid_retrieval.config import Config
from hybrid_retrieval.db import connect
from hybrid_retrieval.eval.metrics import (
    MetricAccumulator,
    hit_at_k,
    ndcg_at_k,
    recall_at_k,
    reciprocal_rank,
)
from hybrid_retrieval.gitlog import Commit, History, load_history
from hybrid_retrieval.index import index_repo
from hybrid_retrieval.rank import FEATURE_NAMES, FeatureContext, GateThresholds, calibrate, extract
from hybrid_retrieval.rank.features import MISSING_DAYS, path_tokens
from hybrid_retrieval.rank.gate import HIGH, LOW, evaluate, gate_signals
from hybrid_retrieval.types import Candidate

DAY = 86400


# -- metrics ----------------------------------------------------------------


def test_recall_counts_the_fraction_of_gold_found():
    assert recall_at_k(["a", "b", "c"], {"a", "d"}, 5) == 0.5
    assert recall_at_k(["a", "b"], {"a", "b"}, 5) == 1.0


def test_recall_respects_the_cutoff():
    assert recall_at_k(["x", "y", "a"], {"a"}, 2) == 0.0
    assert recall_at_k(["x", "y", "a"], {"a"}, 3) == 1.0


def test_hit_is_all_or_nothing():
    assert hit_at_k(["a", "b"], {"a", "z"}, 5) == 1.0
    assert hit_at_k(["a", "b"], {"z"}, 5) == 0.0


def test_reciprocal_rank_uses_the_first_hit():
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert reciprocal_rank(["a"], {"a"}) == 1.0
    assert reciprocal_rank(["x"], {"a"}) == 0.0


def test_ndcg_rewards_putting_gold_first():
    early = ndcg_at_k(["a", "x", "y"], {"a"}, 10)
    late = ndcg_at_k(["x", "y", "a"], {"a"}, 10)
    assert early == 1.0
    assert early > late > 0


def test_accumulator_averages_across_queries():
    acc = MetricAccumulator()
    acc.add(["a"], {"a"})
    acc.add(["x"], {"a"})
    summary = acc.summary()
    assert summary["hit@1"] == 0.5
    assert summary["queries"] == 2


def test_empty_accumulator_is_empty():
    assert MetricAccumulator().summary() == {}


# -- git history ------------------------------------------------------------


@pytest.fixture
def history() -> History:
    return History(
        [
            Commit("a", 100 * DAY, "add jwt service", ("src/Jwt.cs",)),
            Commit("b", 150 * DAY, "fix jwt refresh", ("src/Jwt.cs", "src/Auth.cs")),
            Commit("c", 200 * DAY, "unrelated change", ("src/Other.cs",)),
        ]
    )


def test_last_touched_is_strictly_before(history: History):
    """Strictness is what stops a commit leaking into its own features."""
    assert history.last_touched_before("src/Jwt.cs", 150 * DAY) == 100 * DAY
    assert history.last_touched_before("src/Jwt.cs", 151 * DAY) == 150 * DAY
    assert history.last_touched_before("src/Jwt.cs", 100 * DAY) is None


def test_churn_counts_a_window(history: History):
    assert history.churn_between("src/Jwt.cs", 0, 300 * DAY) == 2
    assert history.churn_between("src/Jwt.cs", 120 * DAY, 300 * DAY) == 1
    assert history.churn_between("src/Missing.cs", 0, 300 * DAY) == 0


def test_eligible_drops_bulk_and_terse_commits():
    history = History(
        [
            Commit("a", 1, "reformat everything", tuple(f"f{i}.cs" for i in range(40))),
            Commit("b", 2, "wip", ("a.cs",)),
            Commit("c", 3, "add jwt refresh rotation", ("a.cs",)),
        ]
    )
    assert [c.sha for c in history.eligible()] == ["c"]


def test_eligible_restricts_to_indexed_files():
    history = History([Commit("a", 1, "add jwt refresh rotation", ("kept.cs", "gone.cs"))])
    (commit,) = history.eligible(keep={"kept.cs"})
    assert commit.files == ("kept.cs",)


def test_commit_with_no_surviving_files_is_dropped():
    history = History([Commit("a", 1, "add jwt refresh rotation", ("gone.cs",))])
    assert history.eligible(keep={"other.cs"}) == []


def test_load_history_parses_a_real_repo(git_repo: Path):
    write(git_repo, "src/A.cs", "class A {}")
    subprocess.run(["git", "add", "-A"], cwd=git_repo, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "add the first class"], cwd=git_repo, check=True
    )
    loaded = load_history(git_repo)
    assert len(loaded) == 1
    assert loaded.commits[0].subject == "add the first class"
    assert loaded.commits[0].files == ("src/A.cs",)


def test_load_history_on_a_non_repo_is_empty(tmp_path: Path):
    assert len(load_history(tmp_path)) == 0


# -- features ---------------------------------------------------------------

JWT = """namespace Api.Auth;

public class JwtService
{
    public string RotateRefreshToken(string token) => token;
}
"""


@pytest.fixture
def indexed(git_repo: Path) -> tuple[Path, sqlite3.Connection]:
    write(git_repo, "src/JwtService.cs", JWT)
    write(git_repo, "test/JwtServiceTests.cs", "namespace Api.Tests;\npublic class T { }\n")
    conn = connect(git_repo)
    index_repo(git_repo, conn=conn)
    yield git_repo, conn
    conn.close()


def test_feature_matrix_shape_matches_names(indexed):
    _, conn = indexed
    candidates = [Candidate(path="src/JwtService.cs")]
    ctx = FeatureContext.load(conn, ["src/JwtService.cs"])
    matrix = extract(candidates, query_terms=["jwt"], ctx=ctx, history=None, as_of=None)
    assert matrix.shape == (1, len(FEATURE_NAMES))
    assert matrix.dtype == np.float32


def test_empty_candidate_list_yields_an_empty_matrix():
    matrix = extract([], query_terms=["x"], ctx=FeatureContext(), history=None, as_of=None)
    assert matrix.shape == (0, len(FEATURE_NAMES))


def test_path_tokens_split_identifiers():
    assert {"src", "jwt", "service"} <= path_tokens("src/JwtService.cs")


def test_language_category_features(indexed):
    """Prose matches prose, so the model needs to see 'this is a doc' to discount it."""
    repo, conn = indexed
    write(repo, "README.md", "# jwt service\nrotates refresh tokens\n")
    write(repo, "install.sh", "#!/bin/sh\necho jwt\n")
    index_repo(repo, conn=conn)

    paths = ["README.md", "install.sh", "src/JwtService.cs"]
    ctx = FeatureContext.load(conn, paths)
    matrix = extract([Candidate(path=p) for p in paths], query_terms=["jwt"], ctx=ctx)
    doc = FEATURE_NAMES.index("is_doc")
    script = FEATURE_NAMES.index("is_script")
    assert matrix[0][doc] == 1.0 and matrix[0][script] == 0.0
    assert matrix[1][script] == 1.0 and matrix[1][doc] == 0.0
    assert matrix[2][doc] == 0.0 and matrix[2][script] == 0.0


def test_test_files_are_flagged(indexed):
    _, conn = indexed
    paths = ["src/JwtService.cs", "test/JwtServiceTests.cs"]
    ctx = FeatureContext.load(conn, paths)
    matrix = extract(
        [Candidate(path=p) for p in paths], query_terms=["jwt"], ctx=ctx
    )
    column = FEATURE_NAMES.index("is_test")
    assert matrix[0][column] == 0.0
    assert matrix[1][column] == 1.0


def test_symbol_exact_match_fires(indexed):
    _, conn = indexed
    ctx = FeatureContext.load(conn, ["src/JwtService.cs"])
    column = FEATURE_NAMES.index("symbol_exact_match")
    hit = extract([Candidate(path="src/JwtService.cs")], query_terms=["jwtservice"], ctx=ctx)
    miss = extract([Candidate(path="src/JwtService.cs")], query_terms=["unrelated"], ctx=ctx)
    assert hit[0][column] == 1.0
    assert miss[0][column] == 0.0


def test_git_features_are_point_in_time(indexed, history: History):
    """The commit being predicted must not appear in its own recency feature."""
    _, conn = indexed
    ctx = FeatureContext.load(conn, ["src/Jwt.cs"])
    candidates = [Candidate(path="src/Jwt.cs")]
    days_column = FEATURE_NAMES.index("git_days_since_touch")

    at_second_commit = extract(
        candidates, query_terms=["jwt"], ctx=ctx, history=history, as_of=150 * DAY
    )
    assert at_second_commit[0][days_column] == 50.0, "sees the first commit, not its own"

    later = extract(
        candidates, query_terms=["jwt"], ctx=ctx, history=history, as_of=200 * DAY
    )
    assert later[0][days_column] == 50.0


def test_git_features_absent_without_history(indexed):
    _, conn = indexed
    ctx = FeatureContext.load(conn, ["src/JwtService.cs"])
    matrix = extract([Candidate(path="src/JwtService.cs")], query_terms=["jwt"], ctx=ctx)
    assert matrix[0][FEATURE_NAMES.index("git_days_since_touch")] == MISSING_DAYS


# -- gate -------------------------------------------------------------------


def _scored(*scores: float) -> list[Candidate]:
    return [Candidate(path=f"f{i}.cs", model_score=s) for i, s in enumerate(scores)]


def test_gate_signals_use_the_selection_boundary():
    top, margin = gate_signals(_scored(5.0, 4.0, 1.0, 0.9), top_n=2)
    assert top == 5.0
    assert margin == pytest.approx(3.0), "rank 2 minus rank 3, not rank 1 minus rank 2"


def test_gate_is_certain_when_nothing_was_rejected():
    _, margin = gate_signals(_scored(1.0, 0.5), top_n=5)
    assert margin == float("inf")


def test_gate_high_and_low():
    thresholds = GateThresholds(min_top_score=1.0, min_boundary_margin=2.0)
    assert evaluate(_scored(5.0, 4.0, 1.0), top_n=2, thresholds=thresholds).decision == HIGH
    assert evaluate(_scored(5.0, 4.0, 3.9), top_n=2, thresholds=thresholds).decision == LOW
    assert evaluate(_scored(0.5, 0.1, -9.0), top_n=2, thresholds=thresholds).decision == LOW


def test_gate_on_empty_candidates_is_low():
    assert evaluate([], top_n=5).decision == LOW


def test_default_gate_admits_everything():
    assert evaluate(_scored(-100.0, -200.0, -300.0), top_n=2).decision == HIGH


def test_calibrate_finds_a_separating_threshold():
    samples = [(5.0, 3.0, True)] * 20 + [(0.1, 0.05, False)] * 20
    thresholds = calibrate(samples, target_precision=0.85)
    assert evaluate(_scored(5.0, 4.0, 1.0), top_n=2, thresholds=thresholds).decision == HIGH
    assert evaluate(_scored(0.1, 0.08, 0.05), top_n=2, thresholds=thresholds).decision == LOW


def test_calibrate_without_samples_is_permissive():
    assert calibrate([]) == GateThresholds()


def test_calibrate_on_a_hopeless_model_stays_quiet():
    """If nothing predicts correctness, the gate should not become confidently wrong."""
    samples = [(float(i % 5), float(i % 3), i % 2 == 0) for i in range(60)]
    thresholds = calibrate(samples, target_precision=0.95)
    assert isinstance(thresholds, GateThresholds)


# -- dataset ----------------------------------------------------------------


def test_split_by_time_holds_out_the_newest():
    from hybrid_retrieval.train import split_by_time

    commits = [Commit(f"s{i}", i, "subject here", ("a.cs",)) for i in range(10)]
    train, holdout = split_by_time(commits, holdout=3)
    assert [c.timestamp for c in train] == list(range(7))
    assert [c.timestamp for c in holdout] == [7, 8, 9]


def test_split_with_oversized_holdout_keeps_everything_for_training():
    from hybrid_retrieval.train import split_by_time

    commits = [Commit("a", 1, "subject here", ("a.cs",))]
    train, holdout = split_by_time(commits, holdout=5)
    assert len(train) == 1 and holdout == []


def test_build_examples_labels_gold_files(indexed):
    from hybrid_retrieval.train import build_examples, from_commit

    repo, conn = indexed
    commits = [Commit("a", 1000, "rotate the refresh token", ("src/JwtService.cs",))]
    examples, stats = build_examples(
        conn, [from_commit(c) for c in commits], history=History([]), cfg=Config(), embedder=None
    )
    assert stats.built == 1
    example = examples[0]
    assert example.n_positive == 1
    gold_index = [c.path for c in example.candidates].index("src/JwtService.cs")
    assert example.labels[gold_index] == 1.0


def test_unreachable_commits_are_dropped_and_counted(indexed):
    from hybrid_retrieval.train import build_examples, from_commit

    _, conn = indexed
    commits = [Commit("a", 1000, "something about nothing here", ("src/Absent.cs",))]
    examples, stats = build_examples(
        conn, [from_commit(c) for c in commits], history=History([]), cfg=Config(), embedder=None
    )
    assert examples == []
    assert stats.dropped_no_candidates + stats.dropped_no_positive == 1
