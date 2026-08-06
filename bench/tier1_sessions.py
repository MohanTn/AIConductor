"""Tier 1 benchmark on real prompts from Claude Code session history.

This is the fair version of the offline eval. `tier1_eval.py` uses commit subjects as stand-in
queries, which favours lexical arms because a commit message usually names the component whose
name is already in the filename. Here the query is a prompt someone actually typed and the gold
set is the files Claude actually opened to answer it.

The held-out slice is the newest prompts, matching how the ranker was trained, so the model is
never scored on anything it learned from.

    uv run python bench/tier1_sessions.py --holdout-fraction 0.2
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hybrid_retrieval.config import Config  # noqa: E402
from hybrid_retrieval.db import connect  # noqa: E402
from hybrid_retrieval.eval.baselines import ripgrep_candidates  # noqa: E402
from hybrid_retrieval.eval.metrics import MetricAccumulator  # noqa: E402
from hybrid_retrieval.gitlog import load_history  # noqa: E402
from hybrid_retrieval.rank import Ranker  # noqa: E402
from hybrid_retrieval.retrieve.pipeline import generate_candidates, rerank  # noqa: E402
from hybrid_retrieval.sessions import group_by_repo, mine  # noqa: E402
from hybrid_retrieval.train import from_session, split_by_time  # noqa: E402

TOP_K = 10

ARMS = {
    "B0": "ripgrep on prompt identifiers",
    "B1": "BM25 only",
    "B4": "RRF + AST, no scorer",
    "B5": "full pipeline (RRF + AST + ranker)",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--holdout-fraction", type=float, default=0.2)
    parser.add_argument("--target", choices=("touched", "edited"), default="touched")
    parser.add_argument("--max-repos", type=int, default=12)
    parser.add_argument("--min-files", type=int, default=0,
                        help="skip repos smaller than this; tiny repos make retrieval trivial")
    parser.add_argument("--ast-depth", type=int, default=None,
                        help="override AST expansion depth for the B4/B5 arms; 0 disables it")
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    examples = mine()
    grouped = {r: e for r, e in group_by_repo(examples).items() if r.is_dir()}
    ranked_repos = sorted(grouped.items(), key=lambda kv: -len(kv[1]))[: args.max_repos]
    keep = {repo for repo, _ in ranked_repos}

    # The split must match training exactly: pooled across repos, newest slice held out. Taking
    # the newest 20% *per repo* instead would put prompts from older repos, which the ranker did
    # train on, into the eval set.
    pooled = [
        (example.repo, from_session(example, target=args.target))
        for example in examples
        if example.repo in keep
    ]
    pooled.sort(key=lambda pair: pair[1].as_of)
    holdout_size = max(1, int(len(pooled) * args.holdout_fraction))
    _, held_out = split_by_time([p[1] for p in pooled], holdout=holdout_size)
    cutoff = held_out[0].as_of if held_out else 0
    by_repo: dict[Path, list] = {}
    for repo, query in pooled:
        if query.as_of >= cutoff:
            by_repo.setdefault(repo, []).append(query)

    accumulators = {key: MetricAccumulator() for key in ARMS}
    timings = {key: 0.0 for key in ARMS}
    per_repo: dict[str, int] = {}
    ceilings: list[float] = []

    for repo, holdout in by_repo.items():
        conn = connect(repo)
        try:
            indexed = {row[0] for row in conn.execute("SELECT path FROM files")}
            if len(indexed) < args.min_files:
                continue
            history = load_history(repo)
            ranker = Ranker.load(repo)
            cfg = Config.load(repo)
            if args.ast_depth is not None:
                cfg.retrieval.ast_depth = args.ast_depth
            used = 0

            for item in holdout:
                gold = set(item.gold) & indexed
                if not gold:
                    continue
                used += 1

                tick = time.perf_counter()
                grep = ripgrep_candidates(repo, item.query, limit=TOP_K, allowed=indexed)
                timings["B0"] += time.perf_counter() - tick
                accumulators["B0"].add(grep[:TOP_K], gold)

                bm25_cfg = Config.load(repo)
                bm25_cfg.retrieval.ast_depth = 0
                tick = time.perf_counter()
                lexical = generate_candidates(
                    conn, item.query, cfg=bm25_cfg, use_dense=False
                ).candidates
                timings["B1"] += time.perf_counter() - tick
                accumulators["B1"].add([c.path for c in lexical][:TOP_K], gold)

                tick = time.perf_counter()
                fused = generate_candidates(conn, item.query, cfg=cfg, use_dense=False).candidates
                generation_s = time.perf_counter() - tick
                timings["B4"] += generation_s
                accumulators["B4"].add([c.path for c in fused][:TOP_K], gold)
                ceilings.append(len({c.path for c in fused} & gold) / len(gold))

                if ranker is not None:
                    tick = time.perf_counter()
                    ordered = rerank(
                        conn, item.query, fused, ranker=ranker, history=history, as_of=item.as_of
                    )
                    timings["B5"] += (time.perf_counter() - tick) + generation_s
                    accumulators["B5"].add([c.path for c in ordered][:TOP_K], gold)

            if used:
                per_repo[f"{repo.name} ({len(indexed)} files)"] = used
        finally:
            conn.close()

    print("held-out prompts per repo:")
    for name, count in sorted(per_repo.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>3}  {name}")
    total = sum(per_repo.values())
    print(f"\n{total} held-out prompts")
    if ceilings:
        print(f"retrieval ceiling: {sum(ceilings) / len(ceilings):.1%}")

    print("\n| arm | description | recall@1 | recall@5 | hit@5 | recall@10 | MRR | ms/q |")
    print("|---|---|---|---|---|---|---|---|")
    results = {}
    for key, label in ARMS.items():
        summary = accumulators[key].summary()
        if not summary or not summary.get("queries"):
            continue
        summary["ms_per_query"] = timings[key] / summary["queries"] * 1000
        results[key] = summary
        print(
            f"| {key} | {label} | {summary['recall@1']:.3f} | {summary['recall@5']:.3f} "
            f"| {summary['hit@5']:.3f} | {summary['recall@10']:.3f} | {summary['mrr']:.3f} "
            f"| {summary['ms_per_query']:.0f} |"
        )

    if "B0" in results and "B5" in results:
        delta = results["B5"]["recall@5"] - results["B0"]["recall@5"]
        print(f"\nB5 - B0 recall@5: {delta:+.3f} ({delta * 100:+.1f}pp)")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2))
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
