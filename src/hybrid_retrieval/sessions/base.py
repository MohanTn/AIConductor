"""Shared types and filters for every session source.

A source's only job is to turn its own storage format into `SessionExample`s: a prompt someone
typed, the repo it was typed in, and the files the agent opened before the next prompt. Everything
after that (label conversion, training, evaluation) is source-agnostic.

Read and edit are kept apart because they mean different things. An edited file was definitely
needed. A read file was only worth a look, and may have been read and discarded, which is exactly
what the pipeline should not pay to inject.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .. import paths as app_paths

# Harness plumbing, not something a human typed.
SKIP_PREFIXES = (
    "<local-command-caveat>",
    "<command-name>",
    "<system-reminder>",
    "<context-augmentation>",
    "/",
)

MIN_PROMPT_CHARS = 25

_CONTINUATIONS = frozenset(
    """
    yes yeah yep ok okay sure go continue proceed next done thanks ty please do it run
    """.split()  # noqa: SIM905
)


@dataclass(frozen=True, slots=True)
class SessionExample:
    prompt: str
    repo: Path
    read_paths: frozenset[str] = field(default_factory=frozenset)
    edited_paths: frozenset[str] = field(default_factory=frozenset)
    timestamp: int = 0
    session_id: str = ""
    source: str = ""

    @property
    def touched(self) -> frozenset[str]:
        return self.read_paths | self.edited_paths


def is_typed_prompt(text: str) -> bool:
    """Whether a record looks like something a person typed, not harness plumbing."""
    stripped = text.strip()
    if len(stripped) < MIN_PROMPT_CHARS:
        return False
    if stripped.startswith(SKIP_PREFIXES):
        return False
    words = stripped.lower().split()
    return not (words and len(words) <= 3 and all(w.strip(".,!") in _CONTINUATIONS for w in words))


def to_epoch(raw: str | int | float | None) -> int:
    if raw is None:
        return 0
    if isinstance(raw, int | float):
        # Some sources store milliseconds.
        return int(raw / 1000) if raw > 1e11 else int(raw)
    try:
        return int(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def relativise(absolute: set[str], root: Path) -> set[str]:
    """Repo-relative POSIX paths, dropping anything outside the repo."""
    out: set[str] = set()
    for raw in absolute:
        try:
            out.add(Path(raw).resolve().relative_to(root).as_posix())
        except (ValueError, OSError):
            continue  # a config file in $HOME, a temp file, another checkout
    return out


def repo_root_of(cwd: str | None) -> Path | None:
    return app_paths.find_repo_root(Path(cwd)) if cwd else None


def make_example(
    *,
    prompt: str,
    cwd: str | None,
    read: set[str],
    edited: set[str],
    timestamp: int,
    session_id: str,
    source: str,
) -> SessionExample | None:
    """Assemble an example, or None if nothing usable survives the filters."""
    if not (read or edited):
        return None
    root = repo_root_of(cwd)
    if root is None:
        return None
    rel_read = relativise(read, root)
    rel_edited = relativise(edited, root)
    if not (rel_read or rel_edited):
        return None
    return SessionExample(
        prompt=prompt,
        repo=root,
        read_paths=frozenset(rel_read - rel_edited),  # read then edited counts as an edit
        edited_paths=frozenset(rel_edited),
        timestamp=timestamp,
        session_id=session_id,
        source=source,
    )


def read_jsonl(path: Path) -> list[dict]:
    """Tolerant JSONL reader: a corrupt line must not lose the rest of the session."""
    records: list[dict] = []
    try:
        raw = path.read_text(errors="replace")
    except OSError:
        return records
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            records.append(parsed)
    return records
