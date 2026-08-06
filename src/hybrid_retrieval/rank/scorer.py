"""LightGBM reranker (decision 24) and its artefact format.

The model is a ranker, not a classifier: it is trained with lambdarank over per-query groups, so
only the ordering it produces is meaningful. The raw scores are unbounded and uncalibrated, which
is exactly why the gate works on margins rather than on absolute values.

The artefact carries the feature names it was trained on. Loading a model whose feature list does
not match the current code is refused rather than silently scoring garbage.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..types import Candidate
from .features import FEATURE_NAMES

log = logging.getLogger(__name__)

ARTEFACT_VERSION = 1


class ModelMismatch(RuntimeError):
    pass


@dataclass
class RankerArtefact:
    """Everything needed to score, plus the provenance to know if it is still valid."""

    feature_names: tuple[str, ...] = FEATURE_NAMES
    version: int = ARTEFACT_VERSION
    trained_on: str = ""
    n_queries: int = 0
    metrics: dict = field(default_factory=dict)
    gate: dict = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(
            {
                "version": self.version,
                "feature_names": list(self.feature_names),
                "trained_on": self.trained_on,
                "n_queries": self.n_queries,
                "metrics": self.metrics,
                "gate": self.gate,
            },
            indent=2,
        )

    @classmethod
    def from_json(cls, raw: str) -> RankerArtefact:
        data = json.loads(raw)
        return cls(
            feature_names=tuple(data.get("feature_names", ())),
            version=int(data.get("version", 0)),
            trained_on=data.get("trained_on", ""),
            n_queries=int(data.get("n_queries", 0)),
            metrics=data.get("metrics", {}),
            gate=data.get("gate", {}),
        )


def model_paths(repo_root: Path | str) -> tuple[Path, Path]:
    from .. import paths as app_paths

    root = Path(repo_root)
    # The pooled cross-repo ranker is written straight into the config dir, not into a repo.
    base = root if root == app_paths.config_dir() else app_paths.index_dir(root)
    return base / "ranker.txt", base / "ranker.json"


def global_model_paths() -> tuple[Path, Path]:
    from .. import paths as app_paths

    return model_paths(app_paths.config_dir())


class Ranker:
    def __init__(self, booster, artefact: RankerArtefact) -> None:
        if tuple(artefact.feature_names) != FEATURE_NAMES:
            raise ModelMismatch(
                "ranker was trained on a different feature set; retrain with `train`"
            )
        self._booster = booster
        self.artefact = artefact

    @classmethod
    def load(cls, repo_root: Path | str) -> Ranker | None:
        """Repo-local ranker if one was trained here, otherwise the pooled cross-repo one.

        A stale repo-local model must not shadow a valid global one. Raising here left a repo with
        no ranker at all, which silently filled the top five with giant test files that a trained
        model's `is_test` feature would have pushed down.
        """
        for model_file, meta_file in (model_paths(repo_root), global_model_paths()):
            if not (model_file.exists() and meta_file.exists()):
                continue
            try:
                import lightgbm as lgb

                booster = lgb.Booster(model_file=str(model_file))
                return cls(booster, RankerArtefact.from_json(meta_file.read_text()))
            except Exception as exc:  # noqa: BLE001 - LightGBM raises its own error types
                log.warning("ignoring unusable ranker at %s: %s", model_file, exc)
                continue
        return None

    def score(self, matrix: np.ndarray) -> np.ndarray:
        if matrix.shape[0] == 0:
            return np.empty((0,), dtype=np.float32)
        return np.asarray(self._booster.predict(matrix), dtype=np.float32)

    def rerank(self, candidates: list[Candidate], matrix: np.ndarray) -> list[Candidate]:
        scores = self.score(matrix)
        scored = [
            Candidate(
                path=candidate.path,
                dense_score=candidate.dense_score,
                dense_rank=candidate.dense_rank,
                sparse_score=candidate.sparse_score,
                sparse_rank=candidate.sparse_rank,
                rrf_score=candidate.rrf_score,
                ast_hops=candidate.ast_hops,
                model_score=float(score),
                n_matching_chunks=candidate.n_matching_chunks,
            )
            for candidate, score in zip(candidates, scores, strict=True)
        ]
        scored.sort(key=lambda c: (-c.model_score, c.path))
        return scored
