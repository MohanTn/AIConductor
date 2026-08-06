"""Mine coding-agent session history for training labels.

Better training data than git history, and the reason is the train/serve gap. A commit subject is
terse, past-tense and written after the fact; a prompt is what you actually type. A model trained
on the first has to generalise to the second. Session transcripts remove the gap: the query *is* a
real prompt, and the labels are the files the agent actually opened to answer it.

Four sources, each a small adapter over its own storage:

| source        | location                                          | verified |
|---------------|---------------------------------------------------|----------|
| claude-code   | ~/.claude/projects/**/*.jsonl                      | yes      |
| pi            | ~/.pi/agent/sessions/**/*.jsonl                    | yes      |
| copilot-cli   | ~/.copilot/session-store.db (SQLite)               | yes      |
| copilot-chat  | VS Code workspaceStorage/*/chatSessions/*.json     | no       |

copilot-chat is unverified: the directories exist here but hold no sessions, so that parser has
never seen real data. Run `hybrid-retrieval sessions` on a machine that uses it before trusting it.
"""

from __future__ import annotations

from pathlib import Path

from . import claude_code, copilot_chat, copilot_cli, pi
from .base import (
    MIN_PROMPT_CHARS,
    SKIP_PREFIXES,
    SessionExample,
    is_typed_prompt,
    make_example,
    read_jsonl,
    relativise,
    to_epoch,
)

SOURCES = {
    claude_code.SOURCE: claude_code.mine,
    pi.SOURCE: pi.mine,
    copilot_cli.SOURCE: copilot_cli.mine,
    copilot_chat.SOURCE: copilot_chat.mine,
}

# Kept for callers that predate the multi-source split.
parse_transcript = claude_code.parse_transcript


def default_projects_dir() -> Path:
    return claude_code.default_dir()


def mine(
    projects_dir: Path | None = None, *, sources: list[str] | None = None
) -> list[SessionExample]:
    """Every usable example across every enabled source, oldest first.

    A source that raises is skipped rather than allowed to take the others down with it: these are
    third-party on-disk formats that change without notice.
    """
    if projects_dir is not None:
        return sorted(claude_code.mine(projects_dir), key=lambda e: e.timestamp)

    wanted = sources or list(SOURCES)
    out: list[SessionExample] = []
    for name in wanted:
        miner = SOURCES.get(name)
        if miner is None:
            continue
        try:
            out.extend(miner())
        except Exception:  # noqa: BLE001 - one broken format must not block the rest
            continue
    out.sort(key=lambda e: e.timestamp)
    return out


def group_by_repo(examples: list[SessionExample]) -> dict[Path, list[SessionExample]]:
    grouped: dict[Path, list[SessionExample]] = {}
    for example in examples:
        grouped.setdefault(example.repo, []).append(example)
    return grouped


def group_by_source(examples: list[SessionExample]) -> dict[str, list[SessionExample]]:
    grouped: dict[str, list[SessionExample]] = {}
    for example in examples:
        grouped.setdefault(example.source, []).append(example)
    return grouped


__all__ = [
    "MIN_PROMPT_CHARS",
    "SKIP_PREFIXES",
    "SOURCES",
    "SessionExample",
    "claude_code",
    "copilot_chat",
    "copilot_cli",
    "default_projects_dir",
    "group_by_repo",
    "group_by_source",
    "is_typed_prompt",
    "make_example",
    "mine",
    "parse_transcript",
    "pi",
    "read_jsonl",
    "relativise",
    "to_epoch",
]
