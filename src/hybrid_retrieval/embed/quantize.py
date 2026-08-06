"""Vector encoding for storage (decision 10).

Embeddings are L2-normalised, so every component lies in [-1, 1] and int8 quantisation is a fixed
scale with no per-vector factor to store. The float32 copy is kept for rescoring the top
``rescore_k`` hits, which is what keeps recall intact after the coarse int8 scan.
"""

from __future__ import annotations

import numpy as np

INT8_SCALE = 127.0


def normalise(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec, axis=-1, keepdims=True)
    return vec / np.maximum(norm, 1e-12)


def to_int8(vec: np.ndarray) -> bytes:
    """One byte per dimension. Must be wrapped in vec_int8(?) on the SQL side."""
    scaled = np.rint(np.asarray(vec, dtype=np.float32) * INT8_SCALE)
    return np.clip(scaled, -128, 127).astype(np.int8).tobytes()


def to_float32(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def from_float32(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
