"""GitHub Copilot CLI: ~/.copilot/session-store.db (SQLite)

The friendliest source of the four, because Copilot records the association itself. Verified
schema (version 6):

    sessions(id, cwd, repository, host_type, branch, summary, created_at, updated_at)
    turns(id, session_id, turn_index, user_message, assistant_response, timestamp)
    session_files(id, session_id, file_path, tool_name, turn_index, first_seen_at)

`session_files.turn_index` ties a file directly to the turn that touched it, so no scanning
forward through a transcript is needed.

The database is opened read-only and via a copy-free URI; Copilot may hold it open with WAL.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from .base import SessionExample, is_typed_prompt, make_example, to_epoch

SOURCE = "copilot-cli"

# tool_name values Copilot records; anything that mutates counts as an edit.
EDIT_TOOLS = frozenset({"create", "edit", "write", "str_replace", "apply_patch", "modify"})


def default_db() -> Path:
    return Path.home() / ".copilot" / "session-store.db"


def _connect(db: Path) -> sqlite3.Connection | None:
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        conn.execute("SELECT 1 FROM sessions LIMIT 1")
        return conn
    except sqlite3.Error:
        return None


def mine(db: Path | None = None) -> list[SessionExample]:
    db = db or default_db()
    if not db.exists():
        return []
    conn = _connect(db)
    if conn is None:
        return []

    try:
        sessions = {
            row[0]: (row[1], row[2])
            for row in conn.execute("SELECT id, cwd, created_at FROM sessions")
        }

        files: dict[tuple[str, int], list[tuple[str, str]]] = {}
        for session_id, turn_index, file_path, tool_name in conn.execute(
            "SELECT session_id, turn_index, file_path, tool_name FROM session_files"
        ):
            if not file_path:
                continue
            files.setdefault((session_id, turn_index or 0), []).append(
                (file_path, str(tool_name or "").lower())
            )

        out: list[SessionExample] = []
        for session_id, turn_index, user_message, timestamp in conn.execute(
            "SELECT session_id, turn_index, user_message, timestamp FROM turns"
        ):
            prompt = (user_message or "").strip()
            if not is_typed_prompt(prompt):
                continue
            touched = files.get((session_id, turn_index or 0), [])
            if not touched:
                continue
            cwd, created_at = sessions.get(session_id, (None, None))
            read = {p for p, tool in touched if tool not in EDIT_TOOLS}
            edited = {p for p, tool in touched if tool in EDIT_TOOLS}
            example = make_example(
                prompt=prompt,
                cwd=cwd,
                read=read,
                edited=edited,
                timestamp=to_epoch(timestamp or created_at),
                session_id=str(session_id),
                source=SOURCE,
            )
            if example is not None:
                out.append(example)
        return out
    finally:
        conn.close()
