"""Tier 1 offline retrieval benchmark (docs/BENCHMARK.md section 5).

Six arms, one held-out query set, no API calls. The held-out commits are the newest ones and are
the same set the ranker was told to keep away from, so B5 is never scored on its training data.

    uv run python bench/tier1_eval.py /tmp/polly --holdout 200
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hybrid_retrieval.config import Config  # noqa: E402
from hybrid_retrieval.db import connect  # noqa: E402
from hybrid_retrieval.eval.baselines import ripgrep_candidates  # noqa: E402
from hybrid_retrieval.eval.metrics import MetricAccumulator  # noqa: E402
from hybrid_retrieval.gitlog import load_history  # noqa: E402
from hybrid_retrieval.rank import Ranker  # noqa: E402
from hybrid_retrieval.retrieve.pipeline import generate_candidates, rerank  # noqa: E402
from hybrid_retrieval.train.dataset import eligible_commits, split_by_time  # noqa: E402

TOP_K = 10


@dataclass
class Arm:
    key: str
    label: str


ARMS = [
    Arm("B0", "ripgrep on query identifiers"),
    Arm("B1", "BM25 only"),
    Arm("B2", "dense only"),
    Arm("B3", "RRF, no AST, no scorer"),
    Arm("B4", "RRF + AST, no scorer"),
    Arm("B5", "full pipeline (RRF + AST + ranker)"),
]


def _cfg(base: Config, *, ast_depth: int | None = None, sparse_k: int | None = None) -> Config:
    cfg = Config.load()
    cfg.__dict__.update({k: v for k, v in base.__dict__.items() if k != "retrieval"})
    cfg.retrieval.__dict__.update(base.retrieval.__dict__)
    if ast_depth is not None:
        cfg.retrieval.ast_depth = ast_depth
    if sparse_k is not None:
        cfg.retrieval.sparse_k = sparse_k
    return cfg


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo")
    parser.add_argument("--holdout", type=int, default=200)
    parser.add_argument("--limit", type=int, default=None, help="cap queries, for a fast run")
    parser.add_argument("--no-dense", action="store_true")
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    cfg = Config.load(repo)
    conn = connect(repo)

    history = load_history(repo)
    commits = eligible_commits(repo, conn, history)
    _, holdout = split_by_time(commits, holdout=args.holdout)
    if args.limit:
        holdout = holdout[-args.limit :]
    if not holdout:
        print("no holdout commits; is this a git repo with history?", file=sys.stderr)
        return 1

    indexed = {row[0] for row in conn.execute("SELECT path FROM files")}
    ranker = Ranker.load(repo)

    embedder = None
    if not args.no_dense:
        from hybrid_retrieval.db import dense_config

        if dense_config(conn) is not None:
            from hybrid_retrieval.embed import Embedder

            embedder = Embedder(
                cfg.embed.model_id,
                device=cfg.embed.device,
                max_seq_length=cfg.embed.max_seq_length,
                batch_size=cfg.embed.batch_size,
                trust_remote_code=cfg.embed.trust_remote_code,
            )

    print(f"repo {repo}")
    print(f"{len(holdout)} held-out commits, {len(indexed)} indexed files")
    print(f"ranker: {'loaded' if ranker else 'not trained'}")
    print(f"dense:  {'on' if embedder else 'off'}\n")

    accumulators = {arm.key: MetricAccumulator() for arm in ARMS}
    timings = {arm.key: 0.0 for arm in ARMS}

    bm25_cfg = _cfg(cfg, ast_depth=0)
    ast_cfg = _cfg(cfg)

    from hybrid_retrieval.retrieve.dense import dense_candidates

    for index, commit in enumerate(holdout, start=1):
        gold = set(commit.files)
        query = commit.subject

        def record(key: str, ranked: list[str], started: float, gold=gold) -> None:
            timings[key] += time.perf_counter() - started
            accumulators[key].add(ranked[:TOP_K], gold)

        tick = time.perf_counter()
        record("B0", ripgrep_candidates(repo, query, limit=TOP_K, allowed=indexed), tick)

        tick = time.perf_counter()
        bm25 = generate_candidates(conn, query, cfg=bm25_cfg, use_dense=False).candidates
        record("B1", [c.path for c in bm25], tick)

        if embedder is not None:
            tick = time.perf_counter()
            only_dense = dense_candidates(
                conn, embedder.encode_query(query), limit=TOP_K, rescore_k=cfg.retrieval.rescore_k
            )
            record("B2", [c.path for c in only_dense], tick)

        tick = time.perf_counter()
        no_ast = generate_candidates(conn, query, cfg=bm25_cfg, embedder=embedder).candidates
        record("B3", [c.path for c in no_ast], tick)

        tick = time.perf_counter()
        fused = generate_candidates(conn, query, cfg=ast_cfg, embedder=embedder).candidates
        generation_s = time.perf_counter() - tick
        record("B4", [c.path for c in fused], tick)

        if ranker is not None:
            tick = time.perf_counter()
            ordered = rerank(
                conn, query, fused, ranker=ranker, history=history, as_of=commit.timestamp
            )
            # B5 reuses B4's candidate set, so charge it that cost too or it looks 20x faster
            # than the arm it is built on.
            record("B5", [c.path for c in ordered], tick - generation_s)

        if index % 25 == 0:
            print(f"  {index}/{len(holdout)}", flush=True)

    print(
        "\n| arm | description | recall@1 | recall@5 | hit@5 | recall@10 "
        "| MRR | nDCG@10 | ms/q |"
    )
    print("|---|---|---|---|---|---|---|---|---|")
    results = {}
    for arm in ARMS:
        summary = accumulators[arm.key].summary()
        if not summary or not summary.get("queries"):
            continue
        per_query_ms = timings[arm.key] / summary["queries"] * 1000
        summary["ms_per_query"] = per_query_ms
        results[arm.key] = summary
        print(
            f"| {arm.key} | {arm.label} | {summary['recall@1']:.3f} | {summary['recall@5']:.3f} "
            f"| {summary['hit@5']:.3f} | {summary['recall@10']:.3f} | {summary['mrr']:.3f} "
            f"| {summary['ndcg@10']:.3f} | {per_query_ms:.0f} |"
        )

    if "B0" in results and "B5" in results:
        delta = results["B5"]["recall@5"] - results["B0"]["recall@5"]
        print(f"\nB5 - B0 recall@5: {delta:+.3f} ({delta * 100:+.1f}pp)")
        print("K3 threshold is +15pp; below that the ML stack is not earning its place.")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2))
        print(f"\nwrote {args.json}")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
