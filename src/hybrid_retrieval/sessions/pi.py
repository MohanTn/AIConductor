"""pi coding agent: ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl

Verified against real sessions on this machine. Record shapes:

    {"type": "session", "id": ..., "timestamp": ..., "cwd": "/home/..."}
    {"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": ...}]}}
    {"type": "message", "message": {"role": "assistant", "content": [
        {"type": "toolCall", "name": "read", "arguments": {"path": "/abs/path"}}]}}

Tool names are lowercase and the path argument is `path`, not `file_path`. The `cwd` lives on the
session record rather than on every message, so it is captured once at the top of the file.
"""

from __future__ import annotations

from pathlib import Path

from .base import SessionExample, is_typed_prompt, make_example, read_jsonl, to_epoch

SOURCE = "pi"

FILE_TOOLS = frozenset({"read", "edit", "write", "create", "str_replace"})
EDIT_TOOLS = frozenset({"edit", "write", "create", "str_replace"})
PATH_KEYS = ("path", "file_path", "filePath", "filename")


def default_dir() -> Path:
    return Path.home() / ".pi" / "agent" / "sessions"


def _text_of(message: dict) -> str | None:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts = [
        block.get("text", "")
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    return "\n".join(parts) if parts else None


def _tool_calls(message: dict):
    content = message.get("content")
    if not isinstance(content, list):
        return
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "toolCall":
            continue
        name = str(block.get("name") or "").lower()
        if name not in FILE_TOOLS:
            continue
        arguments = block.get("arguments") or {}
        for key in PATH_KEYS:
            value = arguments.get(key)
            if isinstance(value, str) and value:
                yield name, value
                break


def parse_transcript(path: Path) -> list[SessionExample]:
    examples: list[SessionExample] = []
    cwd: str | None = None
    session_id = ""
    prompt: str | None = None
    when = 0
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
        kind = record.get("type")
        if kind == "session":
            cwd = record.get("cwd") or cwd
            session_id = record.get("id") or session_id
            continue
        if kind != "message":
            continue

        message = record.get("message") or {}
        role = message.get("role")
        if role == "user":
            text = (_text_of(message) or "").strip()
            if is_typed_prompt(text):
                flush()
                prompt = text
                when = to_epoch(record.get("timestamp"))
                read, edited = set(), set()
            continue
        if role == "assistant" and prompt is not None:
            for name, file_path in _tool_calls(message):
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
