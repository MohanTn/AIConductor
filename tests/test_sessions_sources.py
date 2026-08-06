"""Parsers for pi, Copilot CLI and Copilot Chat.

Each fixture mirrors the real on-disk shape verified on this machine, except copilot-chat, whose
storage was empty here and whose parser is therefore written defensively rather than to a
confirmed schema.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.sessions import SOURCES, copilot_chat, copilot_cli, group_by_source, mine, pi


@pytest.fixture
def repo(git_repo: Path) -> Path:
    write(git_repo, "src/service.py", "def rotate(): pass")
    write(git_repo, "src/controller.py", "def login(): pass")
    return git_repo


# -- pi ---------------------------------------------------------------------


def _pi_session(tmp_path: Path, repo: Path, records: list[dict]) -> Path:
    directory = tmp_path / "--home--"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "2026-01-01T00-00-00-000Z_abc.jsonl"
    head = {
        "type": "session",
        "id": "sess-1",
        "timestamp": "2026-01-01T00:00:00.000Z",
        "cwd": str(repo),
    }
    path.write_text("\n".join(json.dumps(r) for r in [head, *records]))
    return path


def _pi_user(text: str) -> dict:
    return {
        "type": "message",
        "timestamp": "2026-01-01T00:00:05.000Z",
        "message": {"role": "user", "content": [{"type": "text", "text": text}]},
    }


def _pi_assistant(calls: list[tuple[str, str]]) -> dict:
    return {
        "type": "message",
        "timestamp": "2026-01-01T00:00:06.000Z",
        "message": {
            "role": "assistant",
            "content": [
                {"type": "toolCall", "id": "c1", "name": name, "arguments": {"path": path}}
                for name, path in calls
            ],
        },
    }


def test_pi_pairs_prompt_with_tool_calls(tmp_path: Path, repo: Path):
    path = _pi_session(
        tmp_path,
        repo,
        [
            _pi_user("rotate the refresh token in the service"),
            _pi_assistant(
                [("read", f"{repo}/src/service.py"), ("edit", f"{repo}/src/controller.py")]
            ),
        ],
    )
    (example,) = pi.parse_transcript(path)
    assert example.source == "pi"
    assert example.read_paths == {"src/service.py"}
    assert example.edited_paths == {"src/controller.py"}
    assert example.repo == repo


def test_pi_takes_cwd_from_the_session_record(tmp_path: Path, repo: Path):
    """pi puts cwd on the session header, not on every message."""
    path = _pi_session(
        tmp_path,
        repo,
        [
            _pi_user("why does login fail for expired tokens"),
            _pi_assistant([("read", f"{repo}/src/service.py")]),
        ],
    )
    (example,) = pi.parse_transcript(path)
    assert example.repo == repo


def test_pi_ignores_non_file_tools(tmp_path: Path, repo: Path):
    path = _pi_session(
        tmp_path,
        repo,
        [
            _pi_user("run the test suite and report failures"),
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "toolCall", "name": "bash", "arguments": {"command": "pytest"}}
                    ],
                },
            },
        ],
    )
    assert pi.parse_transcript(path) == []


def test_pi_thinking_blocks_do_not_become_prompts(tmp_path: Path, repo: Path):
    path = _pi_session(
        tmp_path,
        repo,
        [
            _pi_user("rotate the refresh token in the service"),
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "thinking", "thinking": "let me read the service first"}],
                },
            },
            _pi_assistant([("read", f"{repo}/src/service.py")]),
        ],
    )
    (example,) = pi.parse_transcript(path)
    assert example.prompt.startswith("rotate the refresh")


def test_pi_missing_directory_is_empty(tmp_path: Path):
    assert pi.mine(tmp_path / "nope") == []


# -- copilot cli ------------------------------------------------------------


def _copilot_db(tmp_path: Path, repo: Path, *, turns, files) -> Path:
    db = tmp_path / "session-store.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE sessions (id TEXT, cwd TEXT, created_at TEXT)")
    conn.execute(
        "CREATE TABLE turns (session_id TEXT, turn_index INT, user_message TEXT, timestamp TEXT)"
    )
    conn.execute(
        "CREATE TABLE session_files "
        "(session_id TEXT, file_path TEXT, tool_name TEXT, turn_index INT)"
    )
    conn.execute(
        "INSERT INTO sessions VALUES ('s1', ?, '2026-01-01T00:00:00.000Z')", (str(repo),)
    )
    conn.executemany("INSERT INTO turns VALUES ('s1', ?, ?, ?)", turns)
    conn.executemany("INSERT INTO session_files VALUES ('s1', ?, ?, ?)", files)
    conn.commit()
    conn.close()
    return db


def test_copilot_cli_joins_turns_to_files(tmp_path: Path, repo: Path):
    db = _copilot_db(
        tmp_path,
        repo,
        turns=[(0, "rotate the refresh token in the service", "2026-01-01T00:00:01.000Z")],
        files=[(f"{repo}/src/service.py", "view", 0), (f"{repo}/src/controller.py", "edit", 0)],
    )
    (example,) = copilot_cli.mine(db)
    assert example.source == "copilot-cli"
    assert example.read_paths == {"src/service.py"}
    assert example.edited_paths == {"src/controller.py"}


def test_copilot_cli_attaches_files_to_the_right_turn(tmp_path: Path, repo: Path):
    """turn_index is recorded per file, so no forward scanning is needed."""
    db = _copilot_db(
        tmp_path,
        repo,
        turns=[
            (0, "first question about the service module", "2026-01-01T00:00:01.000Z"),
            (1, "second question about the controller module", "2026-01-01T00:00:09.000Z"),
        ],
        files=[(f"{repo}/src/service.py", "view", 0), (f"{repo}/src/controller.py", "edit", 1)],
    )
    first, second = sorted(copilot_cli.mine(db), key=lambda e: e.timestamp)
    assert first.touched == {"src/service.py"}
    assert second.touched == {"src/controller.py"}


def test_copilot_cli_skips_turns_without_files(tmp_path: Path, repo: Path):
    db = _copilot_db(
        tmp_path,
        repo,
        turns=[(0, "what is your favourite colour anyway", "2026-01-01T00:00:01.000Z")],
        files=[],
    )
    assert copilot_cli.mine(db) == []


def test_copilot_cli_missing_db_is_empty(tmp_path: Path):
    assert copilot_cli.mine(tmp_path / "absent.db") == []


def test_copilot_cli_unreadable_db_is_empty(tmp_path: Path):
    broken = tmp_path / "broken.db"
    broken.write_text("not a database")
    assert copilot_cli.mine(broken) == []


# -- copilot chat (unverified format) ---------------------------------------


def _chat_workspace(tmp_path: Path, repo: Path, session: dict) -> Path:
    root = tmp_path / "workspaceStorage"
    workspace = root / "abc123"
    (workspace / "chatSessions").mkdir(parents=True)
    (workspace / "workspace.json").write_text(json.dumps({"folder": f"file://{repo}"}))
    (workspace / "chatSessions" / "s1.json").write_text(json.dumps(session))
    return root


def test_copilot_chat_extracts_prompt_and_referenced_files(tmp_path: Path, repo: Path):
    root = _chat_workspace(
        tmp_path,
        repo,
        {
            "sessionId": "s1",
            "creationDate": "2026-01-01T00:00:00.000Z",
            "requests": [
                {
                    "message": {"text": "rotate the refresh token in the service"},
                    "variableData": {
                        "variables": [{"value": {"fsPath": f"{repo}/src/service.py"}}]
                    },
                    "contentReferences": [{"reference": {"uri": f"file://{repo}/src/controller.py"}}],
                }
            ],
        },
    )
    (example,) = copilot_chat.mine([root])
    assert example.source == "copilot-chat"
    assert example.touched == {"src/service.py", "src/controller.py"}
    assert example.edited_paths == frozenset(), "VS Code records references, not edits"


def test_copilot_chat_resolves_the_workspace_folder(tmp_path: Path, repo: Path):
    root = _chat_workspace(
        tmp_path,
        repo,
        {
            "requests": [
                {
                    "message": {"text": "why does login fail for expired tokens"},
                    "contentReferences": [{"uri": f"file://{repo}/src/service.py"}],
                }
            ]
        },
    )
    (example,) = copilot_chat.mine([root])
    assert example.repo == repo


def test_copilot_chat_without_references_is_dropped(tmp_path: Path, repo: Path):
    root = _chat_workspace(
        tmp_path,
        repo,
        {"requests": [{"message": {"text": "what is your favourite colour anyway"}}]},
    )
    assert copilot_chat.mine([root]) == []


def test_copilot_chat_malformed_json_is_survivable(tmp_path: Path, repo: Path):
    root = tmp_path / "workspaceStorage"
    chat = root / "abc" / "chatSessions"
    chat.mkdir(parents=True)
    (root / "abc" / "workspace.json").write_text(json.dumps({"folder": f"file://{repo}"}))
    (chat / "broken.json").write_text("{ not json")
    assert copilot_chat.mine([root]) == []


# -- registry ---------------------------------------------------------------


def test_every_source_is_registered():
    assert set(SOURCES) == {"claude-code", "pi", "copilot-cli", "copilot-chat"}


def test_a_broken_source_does_not_block_the_others(monkeypatch: pytest.MonkeyPatch):
    def explode():
        raise RuntimeError("format changed")

    monkeypatch.setitem(SOURCES, "pi", explode)
    mine(sources=["pi"])  # must not raise


def test_group_by_source_partitions_examples(tmp_path: Path, repo: Path):
    path = _pi_session(
        tmp_path,
        repo,
        [
            _pi_user("rotate the refresh token in the service"),
            _pi_assistant([("read", f"{repo}/src/service.py")]),
        ],
    )
    grouped = group_by_source(pi.parse_transcript(path))
    assert set(grouped) == {"pi"}
