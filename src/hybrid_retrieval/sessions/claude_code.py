"""Claude Code transcripts: ~/.claude/projects/<encoded-cwd>/<session>.jsonl

One JSON object per line. A typed prompt is a `user` record whose content is a string, or a list
containing a text block. Tool calls are `tool_use` blocks inside `assistant` records, and
Read/Edit/Write carry `file_path`.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from .base import SessionExample, is_typed_prompt, make_example, read_jsonl, to_epoch

SOURCE = "claude-code"

FILE_TOOLS = frozenset({"Read", "Edit", "Write", "NotebookEdit"})
EDIT_TOOLS = frozenset({"Edit", "Write", "NotebookEdit"})


def default_dir() -> Path:
    return Path.home() / ".claude" / "projects"


def _prompt_of(record: dict) -> str | None:
    if record.get("type") != "user" or record.get("isSidechain"):
        return None
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        if not parts:
            return None
        text = "\n".join(parts)
    else:
        return None
    text = text.strip()
    return text if is_typed_prompt(text) else None


def _tool_files(record: dict) -> Iterator[tuple[str, str]]:
    if record.get("type") != "assistant":
        return
    for block in (record.get("message") or {}).get("content") or []:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        name = block.get("name")
        if name in FILE_TOOLS:
            file_path = (block.get("input") or {}).get("file_path")
            if file_path:
                yield name, file_path


def parse_transcript(path: Path) -> list[SessionExample]:
    examples: list[SessionExample] = []
    prompt: str | None = None
    cwd: str | None = None
    when = 0
    session_id = ""
    read: set[str] = set()
    edited: set[str] = set()

    def flush() -> None:
        if prompt is None:
            return
        example = make_example(
            prompt=prompt,
            cwd=cwd,
            read=read,
            edited=edited,
            timestamp=when,
            session_id=session_id,
            source=SOURCE,
        )
        if example is not None:
            examples.append(example)

    for record in read_jsonl(path):
        text = _prompt_of(record)
        if text is not None:
            flush()
            prompt = text
            cwd = record.get("cwd")
            when = to_epoch(record.get("timestamp"))
            session_id = record.get("sessionId") or record.get("session_id") or ""
            read, edited = set(), set()
            continue
        if prompt is None:
            continue
        for name, file_path in _tool_files(record):
            (edited if name in EDIT_TOOLS else read).add(file_path)

    flush()
    return examples


def mine(root: Path | None = None) -> list[SessionExample]:
    root = root or default_dir()
    if not root.is_dir():
        return []
    out: list[SessionExample] = []
    for transcript in sorted(root.rglob("*.jsonl")):
        out.extend(parse_transcript(transcript))
    return out
