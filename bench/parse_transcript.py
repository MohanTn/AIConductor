"""Turn a Claude Code session transcript into the metrics BENCHMARK.md section 8 needs.

Costs are reported in input-token-equivalents (ITE): everything priced relative to one uncached
input token, so the comparison holds regardless of which model ran. Fill the ratios from current
pricing at report time rather than trusting anything hardcoded here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Price of each token type relative to one uncached input token. Defaults are the usual shape of
# Anthropic pricing (cache reads cheap, cache writes a premium, output several times input) and
# MUST be re-checked against current published pricing before any published number.
DEFAULT_RATIOS = {"cache_read": 0.1, "cache_write": 1.25, "output": 5.0}

DISCOVERY_TOOLS = {"Glob", "Grep", "Read", "WebSearch"}
EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}


@dataclass
class RunMetrics:
    session_id: str = ""
    turns: int = 0
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    wall_seconds: float = 0.0
    discovery_calls: int = 0
    discovery_calls_before_first_edit: int = 0
    read_paths: list[str] = field(default_factory=list)
    edited_paths: list[str] = field(default_factory=list)
    injected_context: bool = False
    injected_persisted: bool = False  # Claude Code spilled the hook output to a file
    injected_chars: int = 0

    def ite(self, ratios: dict[str, float] | None = None) -> float:
        r = ratios or DEFAULT_RATIOS
        return (
            self.input_tokens
            + self.cache_read_tokens * r["cache_read"]
            + self.cache_write_tokens * r["cache_write"]
            + self.output_tokens * r["output"]
        )

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
            + self.output_tokens
        )


def _epoch(raw: str | None) -> float:
    if not raw:
        return 0.0
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def parse(path: Path) -> RunMetrics:
    metrics = RunMetrics()
    timestamps: list[float] = []
    seen_edit = False

    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue

        when = _epoch(record.get("timestamp"))
        if when:
            timestamps.append(when)
        metrics.session_id = metrics.session_id or (record.get("sessionId") or "")

        # UserPromptSubmit hook output arrives as its own `attachment` record, not inside the
        # user message. Above roughly 40KB Claude Code writes it to a file and inlines a
        # <persisted-output> pointer instead, so a large injection may never reach the model at
        # all — which makes an uncapped payload a correctness problem, not only a cost one.
        if record.get("type") == "attachment":
            attachment = record.get("attachment") or {}
            if attachment.get("type") == "hook_additional_context":
                blob = json.dumps(attachment.get("content"))
                metrics.injected_context = True
                metrics.injected_chars += len(blob)
                if "persisted-output" in blob or "Output too large" in blob:
                    metrics.injected_persisted = True

        if record.get("type") != "assistant":
            continue

        message = record.get("message") or {}
        usage = message.get("usage") or {}
        metrics.turns += 1
        metrics.input_tokens += usage.get("input_tokens", 0) or 0
        metrics.cache_read_tokens += usage.get("cache_read_input_tokens", 0) or 0
        metrics.cache_write_tokens += usage.get("cache_creation_input_tokens", 0) or 0
        metrics.output_tokens += usage.get("output_tokens", 0) or 0

        for block in message.get("content") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name") or ""
            file_path = (block.get("input") or {}).get("file_path")
            if name in EDIT_TOOLS:
                seen_edit = True
                if file_path:
                    metrics.edited_paths.append(file_path)
            elif name in DISCOVERY_TOOLS:
                metrics.discovery_calls += 1
                if not seen_edit:
                    metrics.discovery_calls_before_first_edit += 1
                if name == "Read" and file_path:
                    metrics.read_paths.append(file_path)

    if timestamps:
        metrics.wall_seconds = max(timestamps) - min(timestamps)
    return metrics


def newest_transcript(project_dir: Path, since: float) -> Path | None:
    """The transcript written by the run that started after `since`."""
    candidates = [p for p in project_dir.glob("*.jsonl") if p.stat().st_mtime >= since]
    return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None
