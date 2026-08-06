"""Dashboard API and HTTP layer."""

from __future__ import annotations

import json
import sqlite3
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from conftest import write
from hybrid_retrieval import paths as app_paths
from hybrid_retrieval import trace
from hybrid_retrieval.config import Config, dumps_toml, overrides, save
from hybrid_retrieval.dashboard import api, build
from hybrid_retrieval.db import connect
from hybrid_retrieval.index import index_repo
from hybrid_retrieval.retrieve import retrieve

JWT = """namespace Api.Auth;

public class JwtService
{
    public string RotateRefreshToken(string token) => token;
}
"""


@pytest.fixture
def indexed(git_repo: Path) -> tuple[Path, sqlite3.Connection]:
    write(git_repo, "src/JwtService.cs", JWT)
    conn = connect(git_repo)
    index_repo(git_repo, conn=conn)
    yield git_repo, conn
    conn.close()


# -- config serialisation ---------------------------------------------------


def test_overrides_are_only_the_differences():
    cfg = Config()
    cfg.top_n = 9
    cfg.retrieval.fuse_to = 30
    assert overrides(cfg) == {"top_n": 9, "retrieval": {"fuse_to": 30}}


def test_unchanged_config_writes_nothing():
    assert overrides(Config()) == {}


def test_toml_round_trips(tmp_path: Path):
    import tomllib

    cfg = Config()
    cfg.top_n = 7
    cfg.max_tokens = 8000
    cfg.embed.enabled = False
    cfg.retrieval.ast_depth = 2
    path = save(cfg, tmp_path / "config.toml")
    with open(path, "rb") as handle:
        parsed = tomllib.load(handle)
    assert parsed == {
        "top_n": 7,
        "max_tokens": 8000,
        "retrieval": {"ast_depth": 2},
        "embed": {"enabled": False},
    }


def test_toml_escapes_strings():
    assert 'a = "he said \\"hi\\""' in dumps_toml({"a": 'he said "hi"'})


# -- api handlers -----------------------------------------------------------


def test_status_reports_index_contents(indexed):
    repo, _ = indexed
    result = api.status(str(repo))
    assert result["files"] == 1
    assert result["chunks"] > 0
    assert result["symbols"] > 0
    assert result["embedder"] is None
    assert {entry["lang"] for entry in result["by_lang"]} == {"csharp"}


def test_status_on_an_unindexed_repo_is_a_clean_404(tmp_path: Path):
    with pytest.raises(api.ApiError) as caught:
        api.status(str(tmp_path))
    assert caught.value.status == 404


def test_status_requires_a_repo():
    with pytest.raises(api.ApiError):
        api.status(None)


def test_get_config_separates_effective_from_overrides(
    indexed, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    repo, _ = indexed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    app_paths.repo_config_file(repo).write_text("top_n = 3\n")
    result = api.get_config(str(repo))
    assert result["effective"]["top_n"] == 3
    assert result["defaults"]["top_n"] == 5
    assert result["overrides"]["top_n"] == 3


def test_put_config_writes_only_overrides(indexed, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    repo, _ = indexed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    result = api.put_config(str(repo), {"top_n": 8, "retrieval": {"fuse_to": 25}})
    written = Path(result["written"]).read_text()
    assert "top_n = 8" in written
    assert "fuse_to = 25" in written
    assert "rrf_k" not in written, "unchanged values must not be pinned into the file"
    assert api.get_config(str(repo))["effective"]["top_n"] == 8


def test_put_config_does_not_bake_in_inherited_globals(
    indexed, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """A repo edit must not silently copy the global config into the repo file."""
    config_home = tmp_path / "cfg"
    (config_home / app_paths.APP).mkdir(parents=True)
    (config_home / app_paths.APP / "config.toml").write_text("latency_budget_ms = 9999\n")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))

    repo, _ = indexed
    result = api.put_config(str(repo), {"top_n": 2})
    written = Path(result["written"]).read_text()
    assert "top_n = 2" in written
    assert "latency_budget_ms" not in written


def test_put_config_rejects_a_non_object():
    with pytest.raises(api.ApiError):
        api.put_config(None, ["not", "a", "dict"], scope="global")


def test_traces_are_returned_newest_first(indexed):
    repo, conn = indexed
    for prompt in ("first prompt about tokens", "second prompt about tokens"):
        result = retrieve(repo, prompt, conn=conn, cfg=Config())
        trace.record(conn, prompt=prompt, result=result)
    rows = api.traces(str(repo))["traces"]
    assert rows[0]["prompt"].startswith("second")


def test_one_trace_missing_is_404(indexed):
    repo, _ = indexed
    with pytest.raises(api.ApiError) as caught:
        api.one_trace(str(repo), 9999)
    assert caught.value.status == 404


def test_probe_without_a_daemon_reports_503(
    indexed, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    repo, _ = indexed
    monkeypatch.setenv("HYBRID_RETRIEVAL_SOCKET", str(tmp_path / "absent.sock"))
    with pytest.raises(api.ApiError) as caught:
        api.probe(str(repo), "rotate the refresh token")
    assert caught.value.status == 503


def test_socket_env_override_is_honoured_everywhere(monkeypatch: pytest.MonkeyPatch):
    """Shim, client and CLI must agree on the socket, or relocating it half-works."""
    monkeypatch.setenv("HYBRID_RETRIEVAL_SOCKET", "/tmp/custom-daemon.sock")
    assert app_paths.socket_path() == Path("/tmp/custom-daemon.sock")


def test_probe_requires_a_prompt(indexed):
    repo, _ = indexed
    with pytest.raises(api.ApiError):
        api.probe(str(repo), "   ")


def test_stage_view_covers_every_stage():
    cards = api._stage_view(
        {"stage_ms": {"sparse": 5.0, "assemble": 1.0}, "paths": ["a.cs"], "tokens": 100},
        {"stages": {"n_fused": 12}, "skipped": 0},
    )
    keys = [c["key"] for c in cards]
    assert keys == ["skip", "sparse", "dense", "fuse", "score", "gate", "fallback", "assemble"]
    assert next(c for c in cards if c["key"] == "sparse")["ran"] is True
    assert next(c for c in cards if c["key"] == "dense")["ran"] is False


def test_dense_note_explains_a_missing_index(indexed):
    """'unavailable' sends people hunting; the card should name the actual cause."""
    repo, _ = indexed
    assert "embed" in api._dense_note(repo, {"dense_used": False})


def test_dense_note_explains_an_embedder_mismatch(indexed, monkeypatch: pytest.MonkeyPatch):
    from hybrid_retrieval.db import ensure_vec_table, transaction

    repo, conn = indexed
    with transaction(conn):
        ensure_vec_table(conn, embedder_id="model/in-index", dim=768)
    monkeypatch.setattr(api, "daemon_health", lambda: {"embedder": "model/loaded"})
    note = api._dense_note(repo, {"dense_used": False})
    assert "model/in-index" in note and "model/loaded" in note


# -- http layer -------------------------------------------------------------


@pytest.fixture
def server():
    httpd = build(host="127.0.0.1", port=0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def _get(base: str, path: str):
    with urllib.request.urlopen(base + path, timeout=10) as response:
        return response.status, json.loads(response.read())


def test_index_page_is_served(server: str):
    with urllib.request.urlopen(server + "/", timeout=10) as response:
        body = response.read().decode()
    assert response.status == 200
    assert "<title>hybrid&#8209;retrieval</title>" in body or "hybrid" in body


def test_page_has_no_external_asset_references():
    """No CDN, no build step: the dashboard must work with the daemon offline and no network."""
    html = (Path(api.__file__).parent / "static" / "index.html").read_text()
    for marker in ("http://", "https://", "cdn.", "<script src", "<link "):
        assert marker not in html, f"unexpected external reference: {marker}"


def test_health_endpoint_works_without_a_daemon(server: str):
    status, body = _get(server, "/api/health")
    assert status == 200
    assert "running" in body


def test_repos_endpoint_returns_a_list(server: str):
    status, body = _get(server, "/api/repos")
    assert status == 200
    assert isinstance(body["repos"], list)


def test_unknown_route_is_404(server: str):
    with pytest.raises(urllib.error.HTTPError) as caught:
        _get(server, "/api/nope")
    assert caught.value.code == 404


def test_status_endpoint_surfaces_api_errors(server: str):
    with pytest.raises(urllib.error.HTTPError) as caught:
        _get(server, "/api/status?repo=/definitely/not/a/repo")
    assert caught.value.code == 404


def test_bad_json_body_is_rejected(server: str):
    request = urllib.request.Request(
        server + "/api/probe", data=b"{ not json", headers={"Content-Type": "application/json"}
    )
    with pytest.raises(urllib.error.HTTPError) as caught:
        urllib.request.urlopen(request, timeout=10)
    assert caught.value.code == 400
