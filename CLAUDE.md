# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A local retrieval pipeline that feeds a coding agent the files it needs before it starts hunting.
A resident daemon indexes a repo, ranks files against a prompt, and a `UserPromptSubmit` hook
injects the result. Everything runs locally; nothing calls a cloud API.

Read `docs/SPEC.md` first. It carries every design decision with its rationale, and sections 10a
through 10i record what changed once the thing was measured — several decisions were reversed by
evidence, and the reasons matter more than the conclusions.

## Commands

```bash
uv sync --all-groups          # install (add --extra dense for the embedding stack)
uv run pytest                 # tests
uv run ruff check .           # lint
uv run hybrid-retrieval doctor
```

## Ground rules specific to this repo

**Pin grammar node types empirically.** Every language adapter has at least one structural
surprise (`export_statement` in TypeScript, `decorated_definition` in Python, block namespaces in
C#). Use `scripts/probe_grammar.py` against a fixture before writing a chunker; guessing has cost
a debugging cycle every time.

**A long-running process holds old code.** After changing anything the daemon imports, run
`hybrid-retrieval stop` before testing. Several "the fix did not work" moments in this repo's
history were a stale daemon.

**The hook must fail open.** Any error, timeout or missing daemon results in exit 0 and no
injection. A retrieval tool must never be able to break a session.

**Claims about quality need a measurement.** `bench/tier1_sessions.py` scores retrieval against
real prompts mined from agent session history; `bench/tier2_runner.py` runs a paired A/B against
headless Claude Code. Both write JSON to `docs/benchmarks/`. Do not assert an improvement that
neither of them shows.

**Payload size is the binding constraint, not ranking.** Break-even for an injection is ~2,095
tokens (`bench/breakeven.py`). Above that it costs more than the discovery it saves, and above
~40KB the harness spills hook output to a file entirely. Retrieval quality is already good;
adding tokens is what loses.
