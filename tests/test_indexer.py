from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval.db import connect
from hybrid_retrieval.index import index_repo, rebuild_edges
from hybrid_retrieval.index.edges import SAME_NAMESPACE_FANOUT_CAP

JWT = """using System;

namespace Api.Auth;

public class JwtService
{
    public string Issue(string sub) => sub;
}
"""

CONTROLLER = """using Api.Auth;

namespace Api.Controllers;

public class AuthController
{
    public string Refresh(string t) => t;
}
"""

OPTIONS = """namespace Api.Auth;

public class JwtOptions
{
    public string Secret { get; set; }
}
"""


@pytest.fixture
def repo(git_repo: Path) -> Path:
    write(git_repo, "src/JwtService.cs", JWT)
    write(git_repo, "src/AuthController.cs", CONTROLLER)
    return git_repo


@pytest.fixture
def conn(git_repo: Path) -> sqlite3.Connection:
    """Depends on git_repo, not repo, so tests can choose whether the C# fixtures exist."""
    c = connect(git_repo)
    yield c
    c.close()


def _paths(conn: sqlite3.Connection, sql: str, *params) -> set:
    return {tuple(row) for row in conn.execute(sql, params)}


def test_full_index_populates_every_table(repo: Path, conn: sqlite3.Connection):
    stats = index_repo(repo, conn=conn)
    assert stats.added == 2
    assert stats.chunks > 0

    assert conn.execute("SELECT COUNT(*) FROM files").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == stats.chunks
    assert conn.execute("SELECT COUNT(*) FROM fts_chunks").fetchone()[0] == stats.chunks
    assert conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0] > 0
    assert conn.execute("SELECT COUNT(*) FROM imports").fetchone()[0] > 0


def test_files_land_not_dense_ready(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    assert conn.execute("SELECT COUNT(*) FROM files WHERE dense_ready = 1").fetchone()[0] == 0


def test_fts_finds_chunk_by_content(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    rows = conn.execute(
        "SELECT path FROM fts_chunks WHERE fts_chunks MATCH 'Issue'"
    ).fetchall()
    assert {r[0] for r in rows} == {"src/JwtService.cs"}


def test_using_edge_resolves_across_files(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    assert ("src/AuthController.cs", "src/JwtService.cs", "using") in _paths(
        conn, "SELECT src, dst, kind FROM edges"
    )


def test_external_usings_create_no_edges(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    assert all(
        dst.startswith("src/") for _, dst, _ in _paths(conn, "SELECT src, dst, kind FROM edges")
    )


def test_same_namespace_edges(repo: Path, conn: sqlite3.Connection):
    write(repo, "src/JwtOptions.cs", OPTIONS)
    index_repo(repo, conn=conn)
    edges = _paths(conn, "SELECT src, dst, kind FROM edges WHERE kind = 'same_namespace'")
    assert ("src/JwtService.cs", "src/JwtOptions.cs", "same_namespace") in edges
    assert ("src/JwtOptions.cs", "src/JwtService.cs", "same_namespace") in edges


def test_same_namespace_fanout_is_capped(git_repo: Path, conn: sqlite3.Connection):
    for i in range(SAME_NAMESPACE_FANOUT_CAP + 2):
        write(git_repo, f"src/T{i}.cs", f"namespace Big;\npublic class T{i} {{ }}\n")
    index_repo(git_repo, conn=conn)
    assert conn.execute(
        "SELECT COUNT(*) FROM edges WHERE kind = 'same_namespace'"
    ).fetchone()[0] == 0, "a namespace this wide is noise, not signal"


def test_second_run_is_a_no_op(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    stats = index_repo(repo, conn=conn)
    assert (stats.added, stats.updated, stats.removed) == (0, 0, 0)
    assert stats.unchanged == 2


def test_content_change_reindexes_only_that_file(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    write(repo, "src/JwtService.cs", JWT.replace("Issue", "IssueToken"))
    stats = index_repo(repo, conn=conn)
    assert (stats.added, stats.updated, stats.removed) == (0, 1, 0)
    symbols = {r[0] for r in conn.execute("SELECT symbol FROM chunks WHERE path = ?",
                                          ("src/JwtService.cs",))}
    assert "JwtService.IssueToken" in symbols
    assert "JwtService.Issue" not in symbols, "stale chunks must be purged"


def test_touching_without_editing_is_unchanged(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    (repo / "src/JwtService.cs").touch()
    stats = index_repo(repo, conn=conn)
    assert stats.updated == 0, "freshness is content-hash based, not mtime based"


def test_deletion_purges_all_rows(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    (repo / "src/JwtService.cs").unlink()
    stats = index_repo(repo, conn=conn)
    assert stats.removed == 1
    for table in ("files", "chunks", "symbols", "imports", "fts_chunks"):
        count = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE path = ?", ("src/JwtService.cs",)
        ).fetchone()[0]
        assert count == 0, table
    assert conn.execute(
        "SELECT COUNT(*) FROM edges WHERE src = ? OR dst = ?",
        ("src/JwtService.cs", "src/JwtService.cs"),
    ).fetchone()[0] == 0


def test_deleted_target_removes_inbound_edge(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    (repo / "src/JwtService.cs").unlink()
    index_repo(repo, conn=conn)
    assert _paths(conn, "SELECT src, dst, kind FROM edges") == set()


def test_scoped_index_only_touches_given_paths(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    write(repo, "src/JwtService.cs", JWT.replace("Issue", "Rotate"))
    write(repo, "src/AuthController.cs", CONTROLLER.replace("Refresh", "Renew"))

    stats = index_repo(repo, conn=conn, paths=["src/JwtService.cs"])
    assert stats.updated == 1
    symbols = {r[0] for r in conn.execute("SELECT symbol FROM chunks")}
    assert "JwtService.Rotate" in symbols
    assert "AuthController.Refresh" in symbols, "unscoped file left alone"


def test_scoped_index_handles_deletion(repo: Path, conn: sqlite3.Connection):
    index_repo(repo, conn=conn)
    (repo / "src/JwtService.cs").unlink()
    stats = index_repo(repo, conn=conn, paths=["src/JwtService.cs"])
    assert stats.removed == 1
    assert conn.execute("SELECT COUNT(*) FROM files").fetchone()[0] == 1


def test_new_file_joining_namespace_updates_neighbours(repo: Path, conn: sqlite3.Connection):
    """The closure must recompute edges for files the change did not touch directly."""
    index_repo(repo, conn=conn)
    write(repo, "src/JwtOptions.cs", OPTIONS)
    index_repo(repo, conn=conn, paths=["src/JwtOptions.cs"])
    edges = _paths(conn, "SELECT src, dst, kind FROM edges WHERE kind = 'same_namespace'")
    assert ("src/JwtService.cs", "src/JwtOptions.cs", "same_namespace") in edges, (
        "existing file gained a neighbour and its edges were never recomputed"
    )


def test_rebuild_all_edges_matches_incremental(repo: Path, conn: sqlite3.Connection):
    write(repo, "src/JwtOptions.cs", OPTIONS)
    index_repo(repo, conn=conn)
    incremental = _paths(conn, "SELECT src, dst, kind FROM edges")
    conn.execute("BEGIN IMMEDIATE")
    rebuild_edges(conn, paths=None)
    conn.execute("COMMIT")
    assert _paths(conn, "SELECT src, dst, kind FROM edges") == incremental


def test_other_languages_get_symbol_chunks(git_repo: Path, conn: sqlite3.Connection):
    write(git_repo, "app/main.py", "def hello():\n    return 1\n")
    stats = index_repo(git_repo, conn=conn)
    assert stats.added == 1
    kinds = {r[0] for r in conn.execute("SELECT kind FROM chunks")}
    assert kinds == {"function_definition"}, "python has a real adapter now"


def test_languages_without_an_adapter_still_get_window_chunks(
    git_repo: Path, conn: sqlite3.Connection
):
    write(git_repo, "README.md", "# title\n\nsome prose about the service\n")
    index_repo(git_repo, conn=conn)
    kinds = {r[0] for r in conn.execute("SELECT kind FROM chunks")}
    assert kinds == {"file"}, "markdown has no adapter, so window chunks rather than nothing"


def test_unreadable_file_does_not_abort_the_pass(repo: Path, conn: sqlite3.Connection):
    write(repo, "src/Binary.cs", b"\x00\x01\x02")
    stats = index_repo(repo, conn=conn)
    assert stats.added == 2, "binary skipped, the rest indexed"
