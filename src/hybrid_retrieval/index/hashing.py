"""Content hashing.

Freshness is keyed on working-tree content, not git hashes (decision 16): the files the agent is
actively editing are uncommitted, and those are exactly the ones retrieval must not be stale on.
"""

from __future__ import annotations

from pathlib import Path

import xxhash

_READ_CHUNK = 1 << 20


def hash_bytes(data: bytes) -> str:
    return xxhash.xxh3_128_hexdigest(data)


def hash_file(path: Path | str) -> str:
    digest = xxhash.xxh3_128()
    with open(path, "rb") as fh:
        while block := fh.read(_READ_CHUNK):
            digest.update(block)
    return digest.hexdigest()
