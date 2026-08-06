"""The honest baseline: what ripgrep alone gives you (benchmark arm B0).

This is the system the pipeline has to beat. If a few grep calls over the identifiers in a prompt
retrieve the same files, the dense + AST + learned-ranking stack is not earning its place — that
is kill criterion K3.

The implementation lives in `retrieve/fallback.py` because it is also the production LOW-confidence
path. The baseline and the fallback must not drift apart.
"""

from __future__ import annotations

from ..retrieve.fallback import MAX_TERMS, ripgrep_paths

ripgrep_candidates = ripgrep_paths

__all__ = ["MAX_TERMS", "ripgrep_candidates", "ripgrep_paths"]
