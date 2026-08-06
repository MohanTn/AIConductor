"""Embedding model wrapper (decisions 12 and 13).

Qwen3-Embedding is instruction-aware and asymmetric: queries carry an instruction prefix,
documents do not. Getting that backwards costs recall silently, so the two paths are separate
methods rather than a flag.

Sized for a 4GB card. fp16 weights are ~1.2GB, sequences are capped at 512 tokens, and an
out-of-memory error halves the batch and retries rather than aborting an index that may have
taken minutes to get this far.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from .quantize import normalise

log = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
DEFAULT_MAX_SEQ = 512
DEFAULT_BATCH = 8

QUERY_TASK = "Given a code search query, retrieve the source files needed to answer it"


def format_query(prompt: str, task: str = QUERY_TASK) -> str:
    """Qwen3's documented query template. Documents are embedded with no prefix at all."""
    return f"Instruct: {task}\nQuery: {prompt}"


class Embedder:
    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        *,
        device: str | None = None,
        max_seq_length: int = DEFAULT_MAX_SEQ,
        batch_size: int = DEFAULT_BATCH,
        use_fp16: bool = True,
        trust_remote_code: bool = False,
    ) -> None:
        import torch
        from sentence_transformers import SentenceTransformer

        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        kwargs: dict[str, Any] = {}
        if use_fp16 and device == "cuda":
            kwargs["torch_dtype"] = torch.float16

        self.model_id = model_id
        self.device = device
        self.batch_size = batch_size
        self._torch = torch
        self._model = SentenceTransformer(
            model_id,
            device=device,
            model_kwargs=kwargs,
            trust_remote_code=trust_remote_code,
        )
        self._model.max_seq_length = max_seq_length

    @property
    def dim(self) -> int:
        getter = getattr(self._model, "get_embedding_dimension", None)  # renamed in newer ST
        if getter is None:
            getter = self._model.get_sentence_embedding_dimension
        return int(getter())

    def encode_documents(self, texts: list[str]) -> np.ndarray:
        return self._encode(texts)

    def encode_query(self, prompt: str) -> np.ndarray:
        return self._encode([format_query(prompt)])[0]

    def _encode(self, texts: list[str]) -> np.ndarray:
        batch = self.batch_size
        while True:
            try:
                vectors = self._model.encode(
                    texts,
                    batch_size=batch,
                    convert_to_numpy=True,
                    normalize_embeddings=False,
                    show_progress_bar=False,
                )
                return normalise(np.asarray(vectors, dtype=np.float32))
            except self._torch.cuda.OutOfMemoryError:
                self._torch.cuda.empty_cache()
                if batch == 1:
                    raise
                batch = max(1, batch // 2)
                log.warning("CUDA OOM while embedding, retrying at batch_size=%d", batch)
