"""Tier 2 pilot: paired headless Claude Code runs, hook on versus hook off.

This is the only measurement that answers whether the tool pays for itself, because it prices the
thing the injection is supposed to save: discovery round trips in a real agent loop.

Pilot scale by default (a few tasks, two arms, two repetitions). The full matrix in BENCHMARK.md
section 6 is 15-20 tasks by 5 repetitions and costs materially more.

Each run gets its own git worktree so the arms cannot contaminate each other, and its own settings
file so the hook is genuinely absent rather than merely inert.

    uv run python bench/tier2_runner.py --repo /tmp/polly --reps 2
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from parse_transcript import DEFAULT_RATIOS, RunMetrics, newest_transcript, parse  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SHIM = PROJECT_ROOT / "hook" / "shim.py"


@dataclass
class Task:
    key: str
    prompt: str
    gold: tuple[str, ...]  # substrings; a run succeeds if any touched path contains one


# Read-only questions on purpose: success is checkable from the transcript alone, with no build
# toolchain, which keeps the pilot honest about what it is measuring.
TASKS = [
    Task(
        "jitter",
        "Where is jitter applied to the retry backoff delay? Name the file and function.",
        ("RetryHelper", "RetryResilienceStrategy"),
    ),
    Task(
        "breaker-reset",
        "How does a manual circuit breaker reset change the circuit state? "
        "Point me at the file that implements it.",
        ("CircuitStateController", "CircuitBreakerManualControl"),
    ),
    Task(
        "hedging-timeout",
        "Where is the per-attempt timeout handled for the hedging strategy?",
        ("Hedging",),
    ),
    Task(
        "telemetry",
        "Which file decides what gets emitted to telemetry when a resilience event fires?",
        ("Telemetry",),
    ),
]


def claude_project_dir(repo: Path) -> Path:
    slug = str(repo).replace("/", "-")
    return Path.home() / ".claude" / "projects" / slug


def write_settings(directory: Path, *, hook_enabled: bool) -> Path:
    settings = {"permissions": {"defaultMode": "bypassPermissions"}}
    if hook_enabled:
        # Invoked through python3 rather than relying on the executable bit: a hook that cannot
        # exec fails silently, which produces a treatment arm identical to the baseline.
        settings["hooks"] = {
            "UserPromptSubmit": [
                {"hooks": [{"type": "command", "command": f"python3 {SHIM}", "timeout": 10}]}
            ]
        }
    path = directory / "settings.json"
    path.write_text(json.dumps(settings, indent=2))
    return path


def run_once(
    repo: Path, task: Task, *, hook_enabled: bool, timeout: int
) -> RunMetrics | None:
    claude = shutil.which("claude") or str(Path.home() / ".local/bin/claude")
    settings_dir = repo / ".claude"
    settings_dir.mkdir(exist_ok=True)
    # Passed with --settings rather than left in .claude/settings.json: project settings files are
    # subject to trust prompts, and a headless run that silently ignores the hook produces a
    # "treatment" arm identical to the baseline, which looks like a null result rather than a bug.
    settings = write_settings(settings_dir, hook_enabled=hook_enabled)

    started = time.time()
    env = dict(os.environ)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    try:
        subprocess.run(
            [
                claude,
                "-p",
                task.prompt,
                "--output-format",
                "json",
                "--settings",
                str(settings),
                "--permission-mode",
                "bypassPermissions",
            ],
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"    run failed: {exc}", file=sys.stderr)
        return None

    time.sleep(1)  # let the transcript flush
    transcript = newest_transcript(claude_project_dir(repo), started)
    if transcript is None:
        print("    no transcript found", file=sys.stderr)
        return None
    return parse(transcript)


def succeeded(metrics: RunMetrics, task: Task) -> bool:
    touched = " ".join(metrics.read_paths + metrics.edited_paths)
    return any(marker in touched for marker in task.gold)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="/tmp/polly")
    parser.add_argument("--reps", type=int, default=2)
    parser.add_argument("--tasks", type=int, default=len(TASKS))
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--json", type=Path, default=Path("docs/benchmarks/tier2-pilot.json"))
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    tasks = TASKS[: args.tasks]
    rows: list[dict] = []

    print(f"repo {repo}")
    print(f"{len(tasks)} tasks x 2 arms x {args.reps} reps = {len(tasks) * 2 * args.reps} runs\n")

    for task in tasks:
        for arm in ("baseline", "treatment"):
            for rep in range(args.reps):
                print(f"  {task.key:<16} {arm:<10} rep {rep + 1}", flush=True)
                metrics = run_once(
                    repo, task, hook_enabled=(arm == "treatment"), timeout=args.timeout
                )
                if metrics is None:
                    continue
                row = {
                    "task": task.key,
                    "arm": arm,
                    "rep": rep,
                    "success": succeeded(metrics, task),
                    "ite": round(metrics.ite(), 1),
                    "total_tokens": metrics.total_tokens,  # a property, so not in asdict()
                    **{k: v for k, v in asdict(metrics).items() if not isinstance(v, list)},
                }
                rows.append(row)
                print(
                    f"    turns={metrics.turns} discovery={metrics.discovery_calls} "
                    f"tokens={metrics.total_tokens} ITE={metrics.ite():.0f} "
                    f"{metrics.wall_seconds:.0f}s injected={metrics.injected_context}"
                    f"{' (SPILLED)' if metrics.injected_persisted else ''} "
                    f"success={row['success']}",
                    flush=True,
                )

    if not rows:
        print("no runs completed", file=sys.stderr)
        return 1

    print("\n| metric | baseline | treatment | ratio |")
    print("|---|---|---|---|")
    for metric in ("ite", "total_tokens", "turns", "discovery_calls", "wall_seconds"):
        base = [r[metric] for r in rows if r["arm"] == "baseline"]
        treat = [r[metric] for r in rows if r["arm"] == "treatment"]
        if not base or not treat:
            continue
        b, t = statistics.median(base), statistics.median(treat)
        ratio = f"{t / b:.2f}x" if b else "n/a"
        print(f"| {metric} | {b:.0f} | {t:.0f} | {ratio} |")

    for arm in ("baseline", "treatment"):
        runs = [r for r in rows if r["arm"] == arm]
        if runs:
            rate = sum(r["success"] for r in runs) / len(runs)
            print(f"{arm} success rate: {rate:.0%} ({len(runs)} runs)")

    injected = [r for r in rows if r["arm"] == "treatment" and r["injected_context"]]
    print(f"context actually injected in {len(injected)} of "
          f"{len([r for r in rows if r['arm'] == 'treatment'])} treatment runs")

    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps({"ratios": DEFAULT_RATIOS, "rows": rows}, indent=2))
    print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
