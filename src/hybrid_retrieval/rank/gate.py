"""Confidence gate (decisions 26 and 27).

The diagram gates on `softmax(100 logits)` with `max_prob > 0.85`, which is unreachable in
practice and, worse, judges the single best file when the pipeline actually ships a set of five.

This gate judges the *set*: how far the last selected candidate sits above the first rejected one,
plus the top score's separation from the pack. Thresholds are calibrated on held-out data rather
than guessed, and land in the model artefact alongside the ranker.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..types import Candidate

HIGH = "HIGH"
LOW = "LOW"


@dataclass(frozen=True, slots=True)
class GateThresholds:
    min_top_score: float = float("-inf")
    min_boundary_margin: float = 0.0

    def to_dict(self) -> dict:
        return {
            "min_top_score": self.min_top_score,
            "min_boundary_margin": self.min_boundary_margin,
        }

    @classmethod
    def from_dict(cls, data: dict | None) -> GateThresholds:
        if not data:
            return cls()
        return cls(
            min_top_score=float(data.get("min_top_score", float("-inf"))),
            min_boundary_margin=float(data.get("min_boundary_margin", 0.0)),
        )


@dataclass(frozen=True, slots=True)
class GateDecision:
    decision: str
    top_score: float
    boundary_margin: float

    @property
    def is_high(self) -> bool:
        return self.decision == HIGH


def gate_signals(candidates: list[Candidate], top_n: int) -> tuple[float, float]:
    """(top score, margin between the last selected and the first rejected candidate)."""
    if not candidates:
        return 0.0, 0.0
    top_score = candidates[0].model_score
    if len(candidates) <= top_n:
        # Nothing was rejected, so there is no boundary to be uncertain about.
        return top_score, float("inf")
    return top_score, candidates[top_n - 1].model_score - candidates[top_n].model_score


def evaluate(
    candidates: list[Candidate], *, top_n: int, thresholds: GateThresholds | None = None
) -> GateDecision:
    thresholds = thresholds or GateThresholds()
    top_score, margin = gate_signals(candidates, top_n)
    if not candidates:
        return GateDecision(LOW, 0.0, 0.0)
    decision = (
        HIGH
        if top_score >= thresholds.min_top_score and margin >= thresholds.min_boundary_margin
        else LOW
    )
    return GateDecision(decision, top_score, margin)


def calibrate(
    samples: list[tuple[float, float, bool]], *, target_precision: float = 0.85
) -> GateThresholds:
    """Pick thresholds from (top_score, margin, was_correct) observations.

    Chooses the pair that keeps HIGH precision at or above ``target_precision`` while firing as
    often as possible. If nothing reaches the target, the most precise option is kept, so a bad
    model becomes a quiet gate rather than a confident wrong one.
    """
    if not samples:
        return GateThresholds()

    finite_margins = sorted({m for _, m, _ in samples if m != float("inf")})
    score_grid = sorted({s for s, _, _ in samples})
    if not score_grid:
        return GateThresholds()

    def quantiles(values: list[float], count: int = 12) -> list[float]:
        if not values:
            return [0.0]
        step = max(1, len(values) // count)
        return sorted({values[i] for i in range(0, len(values), step)} | {values[0]})

    best: tuple[float, float, GateThresholds] | None = None
    for min_score in quantiles(score_grid):
        for min_margin in quantiles(finite_margins) or [0.0]:
            fired = [ok for s, m, ok in samples if s >= min_score and m >= min_margin]
            if not fired:
                continue
            precision = sum(fired) / len(fired)
            coverage = len(fired) / len(samples)
            candidate = (precision, coverage, GateThresholds(min_score, min_margin))
            if precision >= target_precision:
                if best is None or best[0] < target_precision or coverage > best[1]:
                    best = candidate
            elif best is None or (best[0] < target_precision and precision > best[0]):
                best = candidate

    return best[2] if best else GateThresholds()
