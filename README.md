# hybrid-retrieval

A local daemon plus a Claude Code `UserPromptSubmit` hook that retrieves the files most relevant
to your prompt and injects them into context before the model sees it.

Dense (sqlite-vec) + sparse (FTS5 BM25) + AST import expansion, fused with RRF, reranked by a
LightGBM model trained on your repo's own git history. Everything runs locally.

- Design: [`docs/SPEC.md`](docs/SPEC.md)
- How it is proven to save tokens and time: [`docs/BENCHMARK.md`](docs/BENCHMARK.md)

## Status

Pre-alpha. See the milestone table in `docs/SPEC.md` §10.

## Try it

```bash
uv run hybrid-retrieval doctor            # check the environment
uv run hybrid-retrieval index  /path/repo # build the sparse index (seconds)
uv run hybrid-retrieval embed  /path/repo # build embeddings (slow, GPU-bound)
uv run hybrid-retrieval query  --repo /path/repo "add jitter to retry backoff"
uv run hybrid-retrieval serve             # resident daemon
uv run hybrid-retrieval dashboard         # web UI on http://127.0.0.1:5111
```

## Dashboard

`hybrid-retrieval dashboard` serves four tabs:

- **Overview** — index contents, embedder, and the reranker's held-out metrics.
- **Pipeline** — type a prompt and watch it move through every stage. The request goes through the
  daemon, so what you see is exactly what the hook does, including the skip rule and the trace it
  writes. Each stage card shows whether it ran, how long it took, and what it produced.
- **Traces** — every recent request, including skipped ones, with the gate decision and token cost.
- **Config** — every setting, with defaults shown and only changed values written to disk. Saves
  to the repo's `.retrieval/config.toml` or globally.

It binds to localhost and has **no authentication**: it exposes repo contents and writes config
files, so do not put it on a network interface. Restart the daemon after saving config, since it
holds its settings in memory.

## Installing the hook

Add to `.claude/settings.json` in any repo you want it active for:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "python3 /ABS/PATH/TO/hook/shim.py" }] }
    ]
  }
}
```

Invoke it through `python3` rather than relying on the file's executable bit. A hook that cannot
exec fails silently: you get no context and no error, which is indistinguishable from the hook
simply deciding to skip. Confirm it is live with `hybrid-retrieval trace` — every request writes a
row, including skipped ones.

The shim autostarts the daemon on first use and fails open: if anything is wrong it injects
nothing and exits 0, so a broken index can never break a session.

## Development

```bash
uv sync --all-groups     # install, including dev tools
uv run pytest            # tests
uv run ruff check .      # lint
```
