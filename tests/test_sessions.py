from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.sessions import (
    SessionExample,
    group_by_repo,
    is_typed_prompt,
    mine,
    parse_transcript,
)
from hybrid_retrieval.train import from_session


def _user(text: str, cwd: str, ts: str = "2026-01-01T00:00:00.000Z", **extra) -> dict:
    return {
        "type": "user",
        "cwd": cwd,
        "timestamp": ts,
        "sessionId": "s1",
        "message": {"content": text},
        **extra,
    }


def _assistant(tools: list[tuple[str, str]], cwd: str) -> dict:
    return {
        "type": "assistant",
        "cwd": cwd,
        "timestamp": "2026-01-01T00:00:01.000Z",
        "message": {
            "content": [
                {"type": "tool_use", "name": name, "input": {"file_path": path}}
                for name, path in tools
            ]
        },
    }


def _transcript(tmp_path: Path, records: list[dict]) -> Path:
    path = tmp_path / "session.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records))
    return path


@pytest.fixture
def repo(git_repo: Path) -> Path:
    write(git_repo, "src/JwtService.cs", "class JwtService {}")
    write(git_repo, "src/AuthController.cs", "class AuthController {}")
    return git_repo


# -- prompt filtering -------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "add jwt refresh token rotation to the auth controller",
        "why does the circuit breaker stay open after a reset?",
    ],
)
def test_real_prompts_are_kept(text: str):
    assert is_typed_prompt(text)


@pytest.mark.parametrize(
    "text",
    [
        "yes",
        "ok go on",
        "continue",
        "/clear",
        "<command-name>/model</command-name>",
        "<local-command-caveat>Caveat: the messages below ...</local-command-caveat>",
        "<system-reminder>As you answer ...</system-reminder>",
        "short",
        "",
    ],
)
def test_plumbing_and_continuations_are_dropped(text: str):
    assert not is_typed_prompt(text)


# -- transcript parsing -----------------------------------------------------


def test_prompt_is_paired_with_the_files_that_followed(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = _transcript(
        tmp_path,
        [
            _user("add jwt refresh token rotation please", cwd),
            _assistant([("Read", f"{repo}/src/JwtService.cs")], cwd),
            _assistant([("Edit", f"{repo}/src/AuthController.cs")], cwd),
        ],
    )
    (example,) = parse_transcript(path)
    assert example.prompt.startswith("add jwt refresh")
    assert example.read_paths == {"src/JwtService.cs"}
    assert example.edited_paths == {"src/AuthController.cs"}
    assert example.touched == {"src/JwtService.cs", "src/AuthController.cs"}


def test_files_attach_to_the_prompt_that_preceded_them(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = _transcript(
        tmp_path,
        [
            _user("first question about the jwt service", cwd),
            _assistant([("Read", f"{repo}/src/JwtService.cs")], cwd),
            _user("second question about the auth controller", cwd),
            _assistant([("Edit", f"{repo}/src/AuthController.cs")], cwd),
        ],
    )
    first, second = parse_transcript(path)
    assert first.touched == {"src/JwtService.cs"}
    assert second.touched == {"src/AuthController.cs"}


def test_edited_wins_over_read_for_the_same_file(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = _transcript(
        tmp_path,
        [
            _user("rotate the refresh token in the jwt service", cwd),
            _assistant([("Read", f"{repo}/src/JwtService.cs")], cwd),
            _assistant([("Edit", f"{repo}/src/JwtService.cs")], cwd),
        ],
    )
    (example,) = parse_transcript(path)
    assert example.edited_paths == {"src/JwtService.cs"}
    assert example.read_paths == frozenset(), "a file read then edited is an edit"


def test_prompts_with_no_file_activity_are_dropped(tmp_path: Path, repo: Path):
    path = _transcript(tmp_path, [_user("what is your favourite colour anyway", str(repo))])
    assert parse_transcript(path) == []


def test_files_outside_the_repo_are_dropped(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = _transcript(
        tmp_path,
        [
            _user("check my global config for the jwt setting", cwd),
            _assistant(
                [("Read", "/home/elsewhere/.bashrc"), ("Read", f"{repo}/src/JwtService.cs")], cwd
            ),
        ],
    )
    (example,) = parse_transcript(path)
    assert example.touched == {"src/JwtService.cs"}


def test_sidechain_records_are_ignored(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = _transcript(
        tmp_path,
        [
            _user("a subagent prompt that should not count", cwd, isSidechain=True),
            _assistant([("Read", f"{repo}/src/JwtService.cs")], cwd),
        ],
    )
    assert parse_transcript(path) == []


def test_cwd_below_the_repo_root_resolves_upward(tmp_path: Path, repo: Path):
    nested = repo / "src"
    path = _transcript(
        tmp_path,
        [
            _user("change the jwt service token rotation", str(nested)),
            _assistant([("Edit", f"{repo}/src/JwtService.cs")], str(nested)),
        ],
    )
    (example,) = parse_transcript(path)
    assert example.repo == repo
    assert example.edited_paths == {"src/JwtService.cs"}


def test_timestamp_is_parsed(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = _transcript(
        tmp_path,
        [
            _user("rotate the refresh token now", cwd, ts="2026-06-01T12:00:00.000Z"),
            _assistant([("Edit", f"{repo}/src/JwtService.cs")], cwd),
        ],
    )
    (example,) = parse_transcript(path)
    assert example.timestamp > 1_700_000_000


def test_malformed_lines_do_not_abort_parsing(tmp_path: Path, repo: Path):
    cwd = str(repo)
    path = tmp_path / "session.jsonl"
    path.write_text(
        "not json\n"
        + json.dumps(_user("rotate the refresh token in jwt", cwd))
        + "\n{ broken\n"
        + json.dumps(_assistant([("Edit", f"{repo}/src/JwtService.cs")], cwd))
        + "\n"
    )
    (example,) = parse_transcript(path)
    assert example.edited_paths == {"src/JwtService.cs"}


def test_mine_on_a_missing_directory_is_empty(tmp_path: Path):
    assert mine(tmp_path / "nope") == []


def test_group_by_repo():
    a = SessionExample(prompt="p", repo=Path("/a"), edited_paths=frozenset({"x"}))
    b = SessionExample(prompt="q", repo=Path("/a"), edited_paths=frozenset({"y"}))
    c = SessionExample(prompt="r", repo=Path("/b"), edited_paths=frozenset({"z"}))
    grouped = group_by_repo([a, b, c])
    assert len(grouped[Path("/a")]) == 2
    assert len(grouped[Path("/b")]) == 1


# -- label conversion -------------------------------------------------------


def test_target_edited_uses_only_edits():
    example = SessionExample(
        prompt="rotate the refresh token",
        repo=Path("/r"),
        read_paths=frozenset({"a.cs"}),
        edited_paths=frozenset({"b.cs"}),
        timestamp=42,
    )
    assert from_session(example, target="edited").gold == {"b.cs"}
    assert from_session(example, target="touched").gold == {"a.cs", "b.cs"}


def test_converted_query_keeps_the_prompt_and_time():
    example = SessionExample(
        prompt="why does the token expire early",
        repo=Path("/r"),
        edited_paths=frozenset({"b.cs"}),
        timestamp=99,
    )
    query = from_session(example)
    assert query.query == "why does the token expire early"
    assert query.as_of == 99
    assert query.source == "session"
