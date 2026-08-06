"""GitHub Copilot Chat in VS Code.

    ~/.config/Code/User/workspaceStorage/<hash>/chatSessions/*.json

UNVERIFIED. The directories exist on this machine but contain zero session files, so unlike the
other three sources this parser has never been run against real data. It is written defensively:
rather than assuming a schema, it walks each request object and collects anything that looks like
a filesystem path (`fsPath`, or a `file://` URI), which survives the layout changes VS Code makes
between releases.

Two consequences of the format worth knowing:

  * VS Code records *references* (files attached to or cited by a turn), not tool calls, so the
    read/edit distinction is unavailable and everything is recorded as a read.
  * The workspace folder is not in the session file. It is recovered from the sibling
    `workspace.json` written by VS Code alongside `chatSessions`.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from .base import SessionExample, is_typed_prompt, make_example, to_epoch

SOURCE = "copilot-chat"

# Every VS Code flavour that ships Copilot Chat.
VSCODE_DIRS = (
    ".config/Code/User/workspaceStorage",
    ".config/Code - Insiders/User/workspaceStorage",
    ".config/VSCodium/User/workspaceStorage",
    ".config/Cursor/User/workspaceStorage",
    ".config/Windsurf/User/workspaceStorage",
    ".vscode-server/data/User/workspaceStorage",
)


def default_dirs() -> list[Path]:
    home = Path.home()
    return [home / rel for rel in VSCODE_DIRS if (home / rel).is_dir()]


def _workspace_folder(chat_dir: Path) -> str | None:
    """VS Code writes the workspace it belongs to in workspace.json next to chatSessions."""
    marker = chat_dir.parent / "workspace.json"
    try:
        data = json.loads(marker.read_text(errors="replace"))
    except (OSError, ValueError):
        return None
    for key in ("folder", "workspace", "configuration"):
        value = data.get(key)
        if isinstance(value, str) and value.startswith("file://"):
            return unquote(urlparse(value).path)
    return None


def _collect_paths(node, found: set[str]) -> None:
    """Walk arbitrary nested JSON for anything path-shaped."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "fsPath" and isinstance(value, str) and value:
                found.add(value)
            elif (
                key in {"uri", "value"}
                and isinstance(value, str)
                and value.startswith("file://")
            ):
                found.add(unquote(urlparse(value).path))
            else:
                _collect_paths(value, found)
    elif isinstance(node, list):
        for item in node:
            _collect_paths(item, found)


def _prompt_of(request: dict) -> str | None:
    message = request.get("message")
    if isinstance(message, dict):
        text = message.get("text")
    elif isinstance(message, str):
        text = message
    else:
        text = None
    if not isinstance(text, str):
        return None
    text = text.strip()
    return text if is_typed_prompt(text) else None


def parse_session(path: Path, workspace: str | None) -> list[SessionExample]:
    try:
        data = json.loads(path.read_text(errors="replace"))
    except (OSError, ValueError):
        return []
    if not isinstance(data, dict):
        return []

    creation = to_epoch(data.get("creationDate") or data.get("lastMessageDate"))
    out: list[SessionExample] = []
    for request in data.get("requests") or []:
        if not isinstance(request, dict):
            continue
        prompt = _prompt_of(request)
        if prompt is None:
            continue
        found: set[str] = set()
        for key in ("variableData", "contentReferences", "response", "result"):
            _collect_paths(request.get(key), found)
        example = make_example(
            prompt=prompt,
            cwd=workspace,
            read=found,  # VS Code records references, not tool calls: no edit signal
            edited=set(),
            timestamp=to_epoch(request.get("timestamp")) or creation,
            session_id=str(data.get("sessionId") or path.stem),
            source=SOURCE,
        )
        if example is not None:
            out.append(example)
    return out


def mine(roots: list[Path] | None = None) -> list[SessionExample]:
    out: list[SessionExample] = []
    for root in roots if roots is not None else default_dirs():
        if not root.is_dir():
            continue
        for chat_dir in sorted(root.glob("*/chatSessions")):
            workspace = _workspace_folder(chat_dir)
            for session_file in sorted(chat_dir.glob("*.json")):
                out.extend(parse_session(session_file, workspace))
    return out
