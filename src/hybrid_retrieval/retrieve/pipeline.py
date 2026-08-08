"""Stage 1-4 orchestration: retrieve, fuse, rerank, gate, assemble.

Candidate generation is exposed separately from ranking because training needs the candidates
without the model that is being trained on them.

Every stage after sparse is optional and degrades rather than fails: no embedder means sparse
only, no trained ranker means the fused order stands, no calibrated gate means always HIGH.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..config import Config
from ..db import dense_config
from ..gitlog import History
from ..rank.features import FeatureContext, extract
from ..rank.gate import GateDecision, GateThresholds, evaluate
from ..text import query_terms
from ..types import Candidate
from .assemble import ContextPack, assemble
from .dense import dense_candidates
from .fallback import ripgrep_candidates
from .fusion import rrf_fuse
from .skip import should_skip
from .sparse import sparse_candidates

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class CandidateSet:
    candidates: list[Candidate] = field(default_factory=list)
    dense_used: bool = False
    stage_ms: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievalResult:
    selected: list[Candidate] = field(default_factory=list)
    fused: list[Candidate] = field(default_factory=list)
    context: ContextPack | None = None
    dense_used: bool = False
    reranked: bool = False
    gate: GateDecision | None = None
    fell_back: bool = False
    skipped: str = ""
    stage_ms: dict[str, float] = field(default_factory=dict)
    latency_ms: float = 0.0

    @property
    def paths(self) -> list[str]:
        return [c.path for c in self.selected]

    @property
    def was_skipped(self) -> bool:
        return bool(self.skipped)


def dense_is_ready(conn: sqlite3.Connection, embedder=None) -> bool:
    """Whether dense retrieval can run against this index with this embedder.

    The daemon holds one model for every repo it serves, but each repo's index records the model
    it was built with and may differ (a per-repo config override, or an index built before a model
    switch). Querying a 768-dimension index with a 1024-dimension vector is a hard SQL error that
    takes down the whole request, so the mismatch is checked here and dense is simply skipped.
    """
    stored = dense_config(conn)
    if stored is None:
        return False
    if embedder is not None and stored != (embedder.model_id, embedder.dim):
        log.warning(
            "index built with %s at %dd but loaded model is %s at %dd; dense retrieval skipped",
            stored[0],
            stored[1],
            embedder.model_id,
            embedder.dim,
        )
        return False
    row = conn.execute("SELECT COUNT(*) FROM files WHERE dense_ready = 1").fetchone()
    return bool(row and row[0])


def generate_candidates(
    conn: sqlite3.Connection,
    prompt: str,
    *,
    cfg: Config,
    embedder=None,
    use_dense: bool = True,
) -> CandidateSet:
    """Stages 1 and 2: dense + sparse retrieval, then RRF fusion with the cut applied."""
    stage_ms: dict[str, float] = {}

    def timed(name: str, fn):
        started = time.perf_counter()
        value = fn()
        stage_ms[name] = (time.perf_counter() - started) * 1000
        return value

    sparse = timed(
        "sparse",
        lambda: sparse_candidates(
            conn, prompt, limit=cfg.retrieval.sparse_k, ast_depth=cfg.retrieval.ast_depth
        ),
    )

    dense: list[Candidate] = []
    dense_used = False
    if use_dense and embedder is not None and dense_is_ready(conn, embedder):
        query_vec = timed("embed", lambda: embedder.encode_query(prompt))
        dense = timed(
            "dense",
            lambda: dense_candidates(
                conn, query_vec, limit=cfg.retrieval.dense_k, rescore_k=cfg.retrieval.rescore_k
            ),
        )
        dense_used = True

    fused = timed(
        "fuse",
        lambda: rrf_fuse(dense, sparse, k=cfg.retrieval.rrf_k, limit=cfg.retrieval.fuse_to),
    )
    return CandidateSet(candidates=fused, dense_used=dense_used, stage_ms=stage_ms)


def rerank(
    conn: sqlite3.Connection,
    prompt: str,
    candidates: list[Candidate],
    *,
    ranker,
    history: History | None = None,
    as_of: int | None = None,
) -> list[Candidate]:
    """Stage 3: score the fused candidates with the learned model."""
    if not candidates:
        return []
    ctx = FeatureContext.load(conn, [c.path for c in candidates])
    matrix = extract(
        candidates,
        query_terms=query_terms(prompt),
        ctx=ctx,
        history=history,
        as_of=as_of,
    )
    return ranker.rerank(candidates, matrix)


def retrieve(
    repo_root: Path | str,
    prompt: str,
    *,
    conn: sqlite3.Connection,
    embedder=None,
    cfg: Config | None = None,
    ranker=None,
    history: History | None = None,
    apply_skip: bool = True,
    assemble_context: bool = True,
) -> RetrievalResult:
    """Retrieve for a prompt.

    ``assemble_context=False`` returns the ranking without reading the selected files. Callers
    that render the payload themselves — which is the shape that actually pays for itself, see
    SPEC section 10j — would otherwise pay for a full-file assembly they discard.
    """
    cfg = cfg or Config.load(Path(repo_root))
    started = time.perf_counter()

    if apply_skip:
        decision_to_skip = should_skip(prompt, cfg.skip)
        if decision_to_skip.skip:
            return RetrievalResult(
                skipped=decision_to_skip.reason,
                context=ContextPack(text=""),
                latency_ms=(time.perf_counter() - started) * 1000,
            )

    generated = generate_candidates(conn, prompt, cfg=cfg, embedder=embedder)
    ordered = generated.candidates
    stage_ms = dict(generated.stage_ms)
    reranked = False
    decision: GateDecision | None = None
    fell_back = False

    if ranker is not None and ordered:
        tick = time.perf_counter()
        ordered = rerank(
            conn,
            prompt,
            ordered,
            ranker=ranker,
            history=history,
            as_of=int(time.time()) if history is not None else None,
        )
        stage_ms["score"] = (time.perf_counter() - tick) * 1000
        reranked = True
        decision = evaluate(
            ordered,
            top_n=cfg.top_n,
            thresholds=GateThresholds.from_dict(ranker.artefact.gate),
        )

        if not decision.is_high:
            # Decision 28: LOW confidence replaces the ranking outright rather than blending.
            tick = time.perf_counter()
            indexed = {row[0] for row in conn.execute("SELECT path FROM files")}
            matches = ripgrep_candidates(
                repo_root, prompt, limit=cfg.retrieval.fuse_to, allowed=indexed
            )
            stage_ms["fallback"] = (time.perf_counter() - tick) * 1000
            if matches:
                ordered = matches
                fell_back = True

    selected = ordered[: cfg.top_n]
    if assemble_context:
        tick = time.perf_counter()
        context = assemble(repo_root, selected, top_n=cfg.top_n, max_tokens=cfg.max_tokens)
        stage_ms["assemble"] = (time.perf_counter() - tick) * 1000
    else:
        context = ContextPack(text="", paths=[c.path for c in selected])

    return RetrievalResult(
        selected=selected,
        fused=ordered,
        context=context,
        dense_used=generated.dense_used,
        reranked=reranked,
        gate=decision,
        fell_back=fell_back,
        stage_ms=stage_ms,
        latency_ms=(time.perf_counter() - started) * 1000,
    )
