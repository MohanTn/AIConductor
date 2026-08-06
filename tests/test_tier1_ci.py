"""Tier 1 regression gate that runs anywhere (M4 exit criterion).

`bench/tier1_eval.py` needs a real repo with real history, so it cannot run on a fresh CI checkout.
This builds a synthetic repo with synthetic commits and runs the whole arm set over it. It is not
a quality benchmark — the numbers mean nothing in absolute terms — it is a regression gate on the
*harness*: mining, candidate generation, feature extraction, training and metrics all still work
end to end, and the pipeline still beats a deliberately bad ordering.

The real quality numbers come from `bench/tier1_sessions.py` on a machine with session history.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.config import Config
from hybrid_retrieval.db import connect
from hybrid_retrieval.eval.metrics import MetricAccumulator
from hybrid_retrieval.gitlog import load_history
from hybrid_retrieval.index import index_repo
from hybrid_retrieval.retrieve import generate_candidates, ripgrep_paths
from hybrid_retrieval.train import eligible_commits, from_commit

MODULES = [
    ("auth", "JwtService", "RotateRefreshToken", "rotate the refresh token for expired sessions"),
    ("auth", "TokenValidator", "ValidateSignature", "validate the jwt signature on inbound tokens"),
    ("billing", "InvoiceRenderer", "RenderInvoice", "render the invoice pdf for a customer"),
    ("billing", "TaxCalculator", "CalculateTax", "calculate sales tax for an invoice line"),
    ("http", "RetryPolicy", "ApplyBackoff", "apply exponential backoff between retry attempts"),
    ("http", "CircuitBreaker", "TripCircuit", "trip the circuit breaker after repeated failures"),
    ("cache", "CacheStore", "EvictExpired", "evict expired entries from the cache store"),
    ("cache", "KeyBuilder", "BuildCacheKey", "build a stable cache key from request parameters"),
]


def _commit(repo: Path, message: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", message], cwd=repo, check=True, capture_output=True
    )


@pytest.fixture(scope="module")
def synthetic_repo(tmp_path_factory) -> Path:
    repo = tmp_path_factory.mktemp("tier1")
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@t.t"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)

    for namespace, type_name, method, message in MODULES:
        write(
            repo,
            f"src/{namespace}/{type_name}.cs",
            f"namespace Api.{namespace.title()};\n\n"
            f"public class {type_name}\n{{\n"
            f"    public string {method}(string input) => input;\n}}\n",
        )
        _commit(repo, message)

    # A second round of edits so every file has more than one commit touching it.
    for namespace, type_name, _method, message in MODULES:
        path = repo / "src" / namespace / f"{type_name}.cs"
        path.write_text(path.read_text().replace("=> input;", "=> input.Trim();"))
        _commit(repo, f"{message} follow-up")

    return repo


def test_history_mining_yields_usable_queries(synthetic_repo: Path):
    conn = connect(synthetic_repo)
    try:
        index_repo(synthetic_repo, conn=conn)
        commits = eligible_commits(synthetic_repo, conn, load_history(synthetic_repo))
        assert len(commits) >= len(MODULES), "mining should recover the synthetic commits"
        assert all(c.files for c in commits)
    finally:
        conn.close()


def test_pipeline_beats_a_bad_ordering_on_every_metric(synthetic_repo: Path):
    """The gate: candidate generation must be better than sorting files alphabetically."""
    conn = connect(synthetic_repo)
    try:
        index_repo(synthetic_repo, conn=conn)
        cfg = Config.load(synthetic_repo)
        commits = eligible_commits(synthetic_repo, conn, load_history(synthetic_repo))
        queries = [from_commit(c) for c in commits]
        indexed = sorted(row[0] for row in conn.execute("SELECT path FROM files"))

        pipeline = MetricAccumulator()
        alphabetical = MetricAccumulator()
        grep = MetricAccumulator()

        for item in queries:
            gold = set(item.gold)
            fused = generate_candidates(conn, item.query, cfg=cfg, use_dense=False).candidates
            pipeline.add([c.path for c in fused][:10], gold)
            alphabetical.add(indexed[:10], gold)
            grep.add(
                ripgrep_paths(synthetic_repo, item.query, limit=10, allowed=set(indexed)), gold
            )

        best = pipeline.summary()
        worst = alphabetical.summary()
        assert best["queries"] >= len(MODULES)
        assert best["recall@5"] > worst["recall@5"]
        assert best["hit@5"] > worst["hit@5"]
        assert best["mrr"] > worst["mrr"]
        # Sanity: ripgrep should also beat alphabetical, or the harness itself is broken.
        assert grep.summary()["hit@5"] > worst["hit@5"]
    finally:
        conn.close()


def test_metrics_are_bounded_and_consistent(synthetic_repo: Path):
    conn = connect(synthetic_repo)
    try:
        index_repo(synthetic_repo, conn=conn)
        cfg = Config.load(synthetic_repo)
        commits = eligible_commits(synthetic_repo, conn, load_history(synthetic_repo))
        acc = MetricAccumulator()
        for item in (from_commit(c) for c in commits):
            fused = generate_candidates(conn, item.query, cfg=cfg, use_dense=False).candidates
            acc.add([c.path for c in fused][:10], set(item.gold))
        summary = acc.summary()
        for key in ("recall@1", "recall@5", "recall@10", "hit@5", "mrr", "ndcg@10"):
            assert 0.0 <= summary[key] <= 1.0, key
        assert summary["recall@1"] <= summary["recall@5"] <= summary["recall@10"]
        assert summary["hit@5"] >= summary["recall@5"] - 1e-9
    finally:
        conn.close()
