"""Configuration, mirroring docs/SPEC.md section 7.

Resolution order: dataclass defaults, then the global config file, then the per-repo override.
Unknown keys are ignored rather than fatal so a newer config file cannot break an older daemon.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import Any

from . import paths


@dataclass
class RetrievalConfig:
    dense_k: int = 100
    sparse_k: int = 80
    fuse_to: int = 50
    rrf_k: int = 60
    # Decision 22 specified depth-2 expansion. Measured three times, most recently with real
    # import graphs from all four adapters, it is neutral-to-negative: disabling it moved the
    # pipeline from +11.3pp to +14.1pp over ripgrep and hit@5 from 0.861 to 0.899. The graph is
    # still built and still feeds the reranker as in-degree and out-degree; only the
    # retrieval-time expansion is off.
    ast_depth: int = 0
    rescore_k: int = 200


@dataclass
class GateConfig:
    mode: str = "calibrated"


@dataclass
class SkipConfig:
    # Length is a poor proxy for "is this a real request": "fix JWT refresh bug" is 19 characters
    # and perfectly answerable, while "could you please have another look at that" is 42 and has
    # nothing to retrieve on. The decision is made on usable query terms instead, with a very low
    # character floor left only to catch the degenerate cases.
    min_prompt_chars: int = 8
    min_query_terms: int = 2
    patterns: list[str] = field(
        default_factory=lambda: [
            r"^/",
            r"^(yes|yep|ok|okay|sure|go on|continue|proceed|run it|do it|thanks)\b",
            r"^\s*$",
        ]
    )


@dataclass
class IndexConfig:
    debounce_ms: int = 1000
    max_file_bytes: int = 1_048_576


@dataclass
class EmbedConfig:
    """Sized for a 4GB card: fp16 weights, short sequences, small batches (decision 12)."""

    enabled: bool = True
    model_id: str = "Qwen/Qwen3-Embedding-0.6B"
    device: str | None = None  # None means cuda when available, else cpu
    max_seq_length: int = 512
    batch_size: int = 8
    files_per_batch: int = 16
    backfill_interval_s: float = 5.0
    trust_remote_code: bool = False  # JinaBERT and friends need this
    # Chunks below this are skipped by the *dense* pass only. A one-line property getter carries
    # no retrievable meaning for an embedding, but is still worth an exact BM25 match, so it stays
    # in the full-text index either way.
    min_chunk_tokens: int = 15


@dataclass
class Config:
    top_n: int = 5
    max_tokens: int | None = None  # decision 30: uncapped by default
    latency_budget_ms: int = 3000
    socket: str = ""
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    gate: GateConfig = field(default_factory=GateConfig)
    skip: SkipConfig = field(default_factory=SkipConfig)
    index: IndexConfig = field(default_factory=IndexConfig)
    embed: EmbedConfig = field(default_factory=EmbedConfig)

    def socket_file(self) -> Path:
        return Path(self.socket).expanduser() if self.socket else paths.socket_path()

    @classmethod
    def load(cls, repo_root: Path | None = None) -> Config:
        cfg = cls()
        _apply(cfg, _read_toml(paths.global_config_file()))
        if repo_root is not None:
            _apply(cfg, _read_toml(paths.repo_config_file(repo_root)))
        return cfg


def _as_dict(value: Any) -> Any:
    if is_dataclass(value):
        return {f.name: _as_dict(getattr(value, f.name)) for f in fields(value)}
    return value


def to_dict(cfg: Config) -> dict[str, Any]:
    return _as_dict(cfg)


def overrides(cfg: Config, baseline: Config | None = None) -> dict[str, Any]:
    """Only the values that differ from the defaults.

    Config files hold overrides rather than a full snapshot, so a future change to a default
    reaches every repo instead of being silently pinned by a file written today.
    """
    baseline = baseline or Config()

    def diff(current: Any, default: Any) -> Any:
        if is_dataclass(current) and is_dataclass(default):
            out = {}
            for spec in fields(current):
                nested = diff(getattr(current, spec.name), getattr(default, spec.name))
                if nested not in (None, {}):
                    out[spec.name] = nested
            return out
        return None if current == default else current

    return diff(cfg, baseline) or {}


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return '""'  # TOML has no null; an empty string reads back as "unset"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, list | tuple):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def dumps_toml(data: dict[str, Any]) -> str:
    """Minimal TOML writer for this config's shape: scalars, lists, one level of sections."""
    scalars = {k: v for k, v in data.items() if not isinstance(v, dict)}
    sections = {k: v for k, v in data.items() if isinstance(v, dict)}
    lines = [f"{key} = {_toml_value(value)}" for key, value in scalars.items()]
    for name, section in sections.items():
        if not section:
            continue
        lines.append("")
        lines.append(f"[{name}]")
        lines.extend(f"{key} = {_toml_value(value)}" for key, value in section.items())
    return "\n".join(lines) + "\n"


def save(cfg: Config, path: Path) -> Path:
    """Persist the non-default values of ``cfg`` to a TOML file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps_toml(overrides(cfg)))
    return path


def apply_updates(cfg: Config, updates: dict[str, Any]) -> Config:
    """Merge a nested mapping onto a config, ignoring unknown keys."""
    _apply(cfg, updates)
    return cfg


def _read_toml(path: Path) -> dict[str, Any]:
    try:
        with open(path, "rb") as fh:
            return tomllib.load(fh)
    except (FileNotFoundError, NotADirectoryError):
        return {}
    except tomllib.TOMLDecodeError as exc:  # malformed config must not kill the daemon
        raise ValueError(f"invalid config at {path}: {exc}") from exc


def _apply(target: Any, data: dict[str, Any]) -> None:
    """Shallow-merge a parsed TOML mapping onto a dataclass instance, recursing into sections."""
    known = {f.name: f for f in fields(target)}
    for key, value in data.items():
        spec = known.get(key)
        if spec is None:
            continue
        current = getattr(target, key)
        if is_dataclass(current) and isinstance(value, dict):
            _apply(current, value)
        else:
            setattr(target, key, value)
