from __future__ import annotations

from pathlib import Path

import pytest

from hybrid_retrieval import paths
from hybrid_retrieval.config import Config


def test_defaults_match_spec():
    cfg = Config()
    assert cfg.top_n == 5
    assert cfg.max_tokens is None, "decision 30: uncapped by default"
    assert cfg.latency_budget_ms == 3000
    assert cfg.retrieval.dense_k == 100
    assert cfg.retrieval.sparse_k == 80
    assert cfg.retrieval.fuse_to == 50, "the diagram's 100-of-100 fusion is a no-op"
    assert cfg.retrieval.rrf_k == 60
    assert cfg.retrieval.ast_depth == 0, "decision 22 reversed: expansion measured as harmful"


def test_repo_config_overrides_global(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config_home = tmp_path / "cfg"
    (config_home / paths.APP).mkdir(parents=True)
    (config_home / paths.APP / "config.toml").write_text(
        "top_n = 8\nmax_tokens = 9000\n[retrieval]\ndense_k = 40\n"
    )
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))

    repo = tmp_path / "repo"
    (repo / paths.INDEX_DIRNAME).mkdir(parents=True)
    (repo / paths.INDEX_DIRNAME / "config.toml").write_text("top_n = 3\n[retrieval]\nrrf_k = 10\n")

    cfg = Config.load(repo)
    assert cfg.top_n == 3, "repo config wins"
    assert cfg.max_tokens == 9000, "global survives where repo is silent"
    assert cfg.retrieval.dense_k == 40, "nested section merges rather than replaces"
    assert cfg.retrieval.rrf_k == 10
    assert cfg.retrieval.sparse_k == 80, "untouched keys keep defaults"


def test_unknown_keys_are_ignored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config_home = tmp_path / "cfg"
    (config_home / paths.APP).mkdir(parents=True)
    (config_home / paths.APP / "config.toml").write_text("from_a_future_version = 1\ntop_n = 2\n")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))
    assert Config.load().top_n == 2


def test_missing_files_yield_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "nope"))
    assert Config.load(tmp_path / "also-nope").top_n == 5


def test_malformed_config_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config_home = tmp_path / "cfg"
    (config_home / paths.APP).mkdir(parents=True)
    (config_home / paths.APP / "config.toml").write_text("top_n = = 3")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))
    with pytest.raises(ValueError, match="invalid config"):
        Config.load()
