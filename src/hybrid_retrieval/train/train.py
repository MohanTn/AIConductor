"""Train the LightGBM reranker and calibrate the gate.

lambdarank with one group per query: only the ordering within a query matters, and absolute
scores are meaningless across queries. That is why the gate downstream reads margins.

The holdout is the newest commits, never a random sample. A random split lets the model learn from
commits that happened after the ones it is evaluated on, which is the same class of leak as using
HEAD-time recency features.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .. import paths as app_paths
from ..config import Config
from ..eval.metrics import MetricAccumulator
from ..gitlog import load_history
from ..rank.features import FEATURE_NAMES
from ..rank.gate import calibrate, gate_signals
from ..rank.scorer import Ranker, RankerArtefact, model_paths
from ..types import Candidate
from .dataset import (
    Example,
    LabelledQuery,
    build_examples,
    eligible_commits,
    from_commit,
    split_by_time,
)

DEFAULT_HOLDOUT = 200


@dataclass
class TrainResult:
    artefact: RankerArtefact
    baseline: dict[str, float]
    trained: dict[str, float]
    train_stats: str
    holdout_stats: str
    duration_s: float

    @property
    def improvement(self) -> float:
        return self.trained.get("recall@5", 0.0) - self.baseline.get("recall@5", 0.0)


def _rank_by(examples: list[Example], scorer) -> MetricAccumulator:
    acc = MetricAccumulator()
    for example in examples:
        ranked = scorer(example)
        acc.add(ranked, example.gold)
    return acc


def _fused_order(example: Example) -> list[str]:
    return [c.path for c in example.candidates]


def train_ranker(
    repo_root: Path | str,
    *,
    conn: sqlite3.Connection,
    cfg: Config | None = None,
    embedder=None,
    holdout: int = DEFAULT_HOLDOUT,
    max_commits: int | None = None,
    progress=None,
) -> TrainResult:

    repo_root = Path(repo_root)
    cfg = cfg or Config.load(repo_root)
    started = time.perf_counter()

    history = load_history(repo_root)
    commits = eligible_commits(repo_root, conn, history)
    if max_commits is not None and len(commits) > max_commits:
        commits = commits[-max_commits:]
    train_commits, holdout_commits = split_by_time(commits, holdout=holdout)
    if not train_commits or not holdout_commits:
        raise ValueError(
            f"not enough usable commits: {len(train_commits)} train, "
            f"{len(holdout_commits)} holdout"
        )

    train_examples, train_stats = build_examples(
        conn,
        [from_commit(c) for c in train_commits],
        history=history,
        cfg=cfg,
        embedder=embedder,
        progress=progress,
    )
    holdout_examples, holdout_stats = build_examples(
        conn,
        [from_commit(c) for c in holdout_commits],
        history=history,
        cfg=cfg,
        embedder=embedder,
    )
    if not train_examples or not holdout_examples:
        raise ValueError("no usable training examples; is the index built?")

    return _fit(
        repo_root,
        train_examples,
        holdout_examples,
        cfg=cfg,
        train_stats=str(train_stats),
        holdout_stats=str(holdout_stats),
        started=started,
    )


def _fit(
    out_root: Path,
    train_examples: list[Example],
    holdout_examples: list[Example],
    *,
    cfg: Config,
    train_stats: str,
    holdout_stats: str,
    started: float,
) -> TrainResult:
    import lightgbm as lgb

    matrix = np.vstack([e.matrix for e in train_examples])
    labels = np.concatenate([e.labels for e in train_examples])
    groups = [len(e.candidates) for e in train_examples]

    dataset = lgb.Dataset(
        matrix, label=labels, group=groups, feature_name=list(FEATURE_NAMES), free_raw_data=False
    )
    booster = lgb.train(
        {
            "objective": "lambdarank",
            "metric": "ndcg",
            "ndcg_eval_at": [5],
            "learning_rate": 0.05,
            "num_leaves": 15,
            "min_data_in_leaf": 20,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.9,
            "bagging_freq": 1,
            "lambdarank_truncation_level": 20,
            "verbosity": -1,
        },
        dataset,
        num_boost_round=200,
    )

    artefact = RankerArtefact(
        trained_on=str(out_root),
        n_queries=len(train_examples),
    )
    ranker = Ranker(booster, artefact)

    def model_order(example: Example) -> list[str]:
        return [c.path for c in ranker.rerank(example.candidates, example.matrix)]

    baseline = _rank_by(holdout_examples, _fused_order).summary()
    trained = _rank_by(holdout_examples, model_order).summary()

    samples: list[tuple[float, float, bool]] = []
    for example in holdout_examples:
        ordered: list[Candidate] = ranker.rerank(example.candidates, example.matrix)
        top_score, margin = gate_signals(ordered, cfg.top_n)
        correct = bool({c.path for c in ordered[: cfg.top_n]} & example.gold)
        samples.append((top_score, margin, correct))
    artefact.gate = calibrate(samples).to_dict()
    artefact.metrics = {"baseline": baseline, "trained": trained}

    model_file, meta_file = model_paths(out_root)
    model_file.parent.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(model_file))
    meta_file.write_text(artefact.to_json())

    return TrainResult(
        artefact=artefact,
        baseline=baseline,
        trained=trained,
        train_stats=train_stats,
        holdout_stats=holdout_stats,
        duration_s=time.perf_counter() - started,
    )


@dataclass
class SessionSource:
    repo_root: Path
    queries: list[LabelledQuery]


def train_from_sessions(
    sources: list[SessionSource],
    *,
    cfg: Config | None = None,
    embedder=None,
    holdout_fraction: float = 0.2,
    out_root: Path | None = None,
    progress=None,
) -> TrainResult:
    """Train one ranker pooled across every repo you have session history for.

    The features are repo-agnostic (retrieval scores, path overlap, recency), so pooling turns a
    few dozen examples per repo into a usable dataset. The holdout is the newest queries across
    the pool, never a random sample.
    """
    from ..db import connect
    from ..gitlog import load_history

    cfg = cfg or Config.load()
    started = time.perf_counter()

    pooled: list[Example] = []
    notes: list[str] = []
    for index, source in enumerate(sources, start=1):
        conn = connect(source.repo_root)
        try:
            history = load_history(source.repo_root)
            indexed = {row[0] for row in conn.execute("SELECT path FROM files")}
            scoped = [
                LabelledQuery(
                    query=q.query,
                    gold=frozenset(q.gold & indexed),
                    as_of=q.as_of,
                    source=q.source,
                )
                for q in source.queries
            ]
            scoped = [q for q in scoped if q.gold]
            if not scoped:
                continue
            built, stats = build_examples(
                conn, scoped, history=history, cfg=cfg, embedder=embedder
            )
            pooled.extend(built)
            notes.append(f"{source.repo_root.name}: {stats}")
        finally:
            conn.close()
        if progress is not None:
            progress(index, len(sources))

    if len(pooled) < 20:
        raise ValueError(f"only {len(pooled)} usable examples across {len(sources)} repos")

    holdout_size = max(1, int(len(pooled) * holdout_fraction))
    train_examples, holdout_examples = split_by_time(pooled, holdout=holdout_size)

    return _fit(
        out_root or Path(app_paths.config_dir()),
        train_examples,
        holdout_examples,
        cfg=cfg,
        train_stats=f"{len(train_examples)} pooled examples | " + " | ".join(notes[:6]),
        holdout_stats=f"{len(holdout_examples)} newest examples held out",
        started=started,
    )
