"""Ranking metrics for the offline benchmark (docs/BENCHMARK.md section 5).

Gold sets have more than one file, so ``recall@k`` (what fraction of the gold set was found) and
``hit@k`` (was anything found at all) answer different questions and both are reported. Hit rate
is the one that matches how the tool is used: the agent needs a foothold, not the whole set.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field


def recall_at_k(ranked: Sequence[str], gold: Iterable[str], k: int) -> float:
    gold_set = set(gold)
    if not gold_set:
        return 0.0
    return len(set(ranked[:k]) & gold_set) / len(gold_set)


def hit_at_k(ranked: Sequence[str], gold: Iterable[str], k: int) -> float:
    return 1.0 if set(ranked[:k]) & set(gold) else 0.0


def reciprocal_rank(ranked: Sequence[str], gold: Iterable[str]) -> float:
    gold_set = set(gold)
    for index, path in enumerate(ranked, start=1):
        if path in gold_set:
            return 1.0 / index
    return 0.0


def ndcg_at_k(ranked: Sequence[str], gold: Iterable[str], k: int) -> float:
    gold_set = set(gold)
    if not gold_set:
        return 0.0
    gain = sum(1.0 / math.log2(i + 1) for i, p in enumerate(ranked[:k], start=1) if p in gold_set)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(len(gold_set), k) + 1))
    return gain / ideal if ideal else 0.0


@dataclass
class MetricAccumulator:
    ks: tuple[int, ...] = (1, 5, 10)
    rows: list[dict[str, float]] = field(default_factory=list)

    def add(self, ranked: Sequence[str], gold: Iterable[str]) -> None:
        gold = list(gold)
        row: dict[str, float] = {"mrr": reciprocal_rank(ranked, gold)}
        for k in self.ks:
            row[f"recall@{k}"] = recall_at_k(ranked, gold, k)
            row[f"hit@{k}"] = hit_at_k(ranked, gold, k)
        row["ndcg@10"] = ndcg_at_k(ranked, gold, 10)
        self.rows.append(row)

    def summary(self) -> dict[str, float]:
        if not self.rows:
            return {}
        keys = self.rows[0].keys()
        out = {key: sum(row[key] for row in self.rows) / len(self.rows) for key in keys}
        out["queries"] = float(len(self.rows))
        return out
