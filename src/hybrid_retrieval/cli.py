"""Command line entry point."""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime
from pathlib import Path

from . import paths
from .config import Config
from .db import connect, dense_config, is_vec_available, schema_version
from .index import RepoWatcher, discover, index_repo

_LANGS = ("csharp", "typescript", "python", "go")


def _resolve_repo(raw: str | None) -> Path:
    start = Path(raw).resolve() if raw else Path.cwd()
    root = paths.find_repo_root(start)
    if root is None:
        raise SystemExit(f"not inside a git repository: {start}")
    return root


def cmd_doctor(args: argparse.Namespace) -> int:
    ok = True

    def report(label: str, good: bool, detail: str = "", *, required: bool = True) -> None:
        """Optional components warn but never fail the exit code, so CI can run without a GPU."""
        nonlocal ok
        if required:
            ok = ok and good
        status = "ok" if good else ("FAIL" if required else "warn")
        print(f"  [{status}] {label}{f' — {detail}' if detail else ''}")

    print("environment")
    report("python", sys.version_info >= (3, 12), sys.version.split()[0])
    report("git", shutil.which("git") is not None)
    report("ripgrep", shutil.which("rg") is not None, "needed for the LOW-confidence fallback")

    print("storage")
    report("sqlite-vec loadable", is_vec_available())

    print("grammars")
    try:
        from tree_sitter_language_pack import get_parser

        for lang in _LANGS:
            try:
                get_parser(lang)
                report(lang, True)
            except Exception as exc:  # noqa: BLE001 - report, do not raise
                report(lang, False, str(exc)[:60])
    except ImportError:
        report("tree-sitter-language-pack", False, "not installed")

    print("accelerator")
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            report(
                "cuda",
                True,
                f"{torch.cuda.get_device_name(0)}, {total / 1e9:.1f} GB total, "
                f"{free / 1e9:.1f} GB free",
            )
        else:
            report("cuda", False, "no device; embeddings will fall back to CPU", required=False)
    except ImportError:
        report("torch", False, "install the 'dense' extra for embeddings", required=False)

    print("paths")
    print(f"  config  {paths.global_config_file()}")
    print(f"  socket  {paths.socket_path()}")
    return 0 if ok else 1


def cmd_scan(args: argparse.Namespace) -> int:
    repo = _resolve_repo(args.repo)
    cfg = Config.load(repo)
    by_lang: dict[str, int] = {}
    total_bytes = 0
    count = 0
    for record in discover(repo, max_file_bytes=cfg.index.max_file_bytes):
        by_lang[record.lang] = by_lang.get(record.lang, 0) + 1
        total_bytes += record.size_bytes
        count += 1
    print(f"repo {repo}")
    for lang, n in sorted(by_lang.items(), key=lambda kv: -kv[1]):
        print(f"  {lang:<12} {n:>6}")
    print(f"  {'total':<12} {count:>6} files, {total_bytes / 1e6:.1f} MB")
    return 0


def cmd_index(args: argparse.Namespace) -> int:
    repo = _resolve_repo(args.repo)
    cfg = Config.load(repo)
    stats = index_repo(repo, cfg=cfg)
    print(f"index {repo}: {stats}")
    if not args.watch:
        return 0

    import threading

    def on_batch(changed: set[str]) -> None:
        incremental = index_repo(repo, cfg=cfg, paths=changed)
        print(f"watch {len(changed)} changed: {incremental}", flush=True)

    watcher = RepoWatcher(repo, on_batch, debounce_ms=cfg.index.debounce_ms)
    watcher.start()
    print(f"watching {repo} (debounce {cfg.index.debounce_ms}ms), ctrl-c to stop", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        watcher.stop()
    return 0


def _load_embedder(cfg: Config):
    from .embed import Embedder

    return Embedder(
        cfg.embed.model_id,
        device=cfg.embed.device,
        max_seq_length=cfg.embed.max_seq_length,
        batch_size=cfg.embed.batch_size,
        trust_remote_code=cfg.embed.trust_remote_code,
    )


def cmd_train(args: argparse.Namespace) -> int:
    from .db import dense_config
    from .train import train_ranker

    repo = _resolve_repo(args.repo)
    cfg = Config.load(repo)
    conn = connect(repo)
    try:
        embedder = None
        if not args.no_dense and dense_config(conn) is not None:
            print(f"loading {cfg.embed.model_id} ...", flush=True)
            embedder = _load_embedder(cfg)

        def progress(done: int, total: int) -> None:
            if done % 50 == 0 or done == total:
                print(f"  built {done}/{total} training queries", flush=True)

        result = train_ranker(
            repo,
            conn=conn,
            cfg=cfg,
            embedder=embedder,
            holdout=args.holdout,
            max_commits=args.max_commits,
            progress=progress,
        )
    except ValueError as exc:
        print(f"cannot train: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    print(f"\ntrain   {result.train_stats}")
    print(f"holdout {result.holdout_stats}")
    print(f"\n{'metric':<12} {'fused':>8} {'reranked':>10} {'delta':>8}")
    for key in ("recall@1", "recall@5", "hit@5", "recall@10", "mrr", "ndcg@10"):
        before = result.baseline.get(key, 0.0)
        after = result.trained.get(key, 0.0)
        print(f"{key:<12} {before:>8.3f} {after:>10.3f} {after - before:>+8.3f}")
    print(f"\ngate {result.artefact.gate}")
    print(f"trained on {result.artefact.n_queries} queries in {result.duration_s:.0f}s")
    return 0


def cmd_sessions(args: argparse.Namespace) -> int:
    """Show what the transcripts contain, before committing to training on them."""
    from .sessions import SOURCES, group_by_repo, group_by_source, mine

    wanted = args.sources.split(",") if args.sources else None
    examples = mine(sources=wanted)

    print("sources:")
    for name in wanted or SOURCES:
        try:
            found = len(SOURCES[name]())
        except Exception as exc:  # noqa: BLE001
            print(f"  {name:<14} error: {str(exc)[:60]}")
            continue
        print(f"  {name:<14} {found:>5} prompts")

    if not examples:
        print("\nno usable session data found")
        return 1

    grouped = group_by_repo(examples)
    live = {repo: items for repo, items in grouped.items() if repo.is_dir()}
    edits = sum(1 for e in examples if e.edited_paths)
    gold_sizes = [len(e.touched) for e in examples]

    print(
        f"\n{len(examples)} usable prompts across {len(grouped)} repos "
        f"({len(live)} still exist)"
    )
    print(f"{edits} of them edited at least one file")
    print(f"mean {sum(gold_sizes) / len(gold_sizes):.1f} files per prompt")

    print("\nby source:")
    for name, items in sorted(group_by_source(examples).items(), key=lambda kv: -len(kv[1])):
        repos = len({e.repo for e in items})
        edited = sum(1 for e in items if e.edited_paths)
        print(f"  {name:<14} {len(items):>4} prompts, {edited:>4} with edits, {repos} repos")

    print("\ntop repos:")
    for repo, items in sorted(live.items(), key=lambda kv: -len(kv[1]))[: args.top]:
        edited = sum(1 for e in items if e.edited_paths)
        by_src = ",".join(sorted({e.source for e in items}))
        print(f"  {len(items):>4} prompts ({edited:>3} with edits)  {repo}  [{by_src}]")
    return 0


def cmd_train_sessions(args: argparse.Namespace) -> int:
    from .db import dense_config
    from .index import index_repo
    from .sessions import group_by_repo, mine
    from .train import SessionSource, from_session, train_from_sessions

    examples = mine(sources=args.sources.split(",") if args.sources else None)
    grouped = {r: e for r, e in group_by_repo(examples).items() if r.is_dir()}
    ranked = sorted(grouped.items(), key=lambda kv: -len(kv[1]))[: args.max_repos]
    if not ranked:
        print("no usable session data", file=sys.stderr)
        return 1

    sources = []
    for repo, items in ranked:
        if args.index:
            stats = index_repo(repo)
            print(f"  indexed {repo.name}: {stats}", flush=True)
        sources.append(
            SessionSource(
                repo_root=repo,
                queries=[from_session(e, target=args.target) for e in items],
            )
        )

    embedder = None
    if args.dense:
        conn = connect(sources[0].repo_root)
        try:
            if dense_config(conn) is not None:
                embedder = _load_embedder(Config.load())
        finally:
            conn.close()

    try:
        result = train_from_sessions(
            sources,
            cfg=Config.load(),
            embedder=embedder,
            holdout_fraction=args.holdout_fraction,
        )
    except ValueError as exc:
        print(f"cannot train: {exc}", file=sys.stderr)
        return 1

    print(f"\ntrain   {result.train_stats}")
    print(f"holdout {result.holdout_stats}")
    print(f"\n{'metric':<12} {'fused':>8} {'reranked':>10} {'delta':>8}")
    for key in ("recall@1", "recall@5", "hit@5", "recall@10", "mrr", "ndcg@10"):
        before = result.baseline.get(key, 0.0)
        after = result.trained.get(key, 0.0)
        print(f"{key:<12} {before:>8.3f} {after:>10.3f} {after - before:>+8.3f}")
    print(f"\nsaved to {paths.config_dir()}")
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    from .dashboard import serve as serve_dashboard

    return serve_dashboard(host=args.host, port=args.port)


def cmd_stop(args: argparse.Namespace) -> int:
    """Ask the daemon to exit. Needed after any code change, since it holds modules in memory."""
    from .daemon import DaemonUnavailable, request

    try:
        response = request({"op": "shutdown"}, timeout=5.0)
    except DaemonUnavailable as exc:
        print(f"no daemon running ({exc})")
        return 0
    print("daemon shutting down" if response.get("ok") else f"error: {response.get('error')}")
    return 0


def cmd_trace(args: argparse.Namespace) -> int:
    """Stage-by-stage breakdown of what the pipeline did, without re-running the query."""
    from . import trace as trace_mod

    repo = _resolve_repo(args.repo)
    conn = connect(repo)
    try:
        if args.prune:
            print(f"pruned {trace_mod.prune(conn, days=args.days)} traces older than {args.days}d")
            return 0

        rows = (
            [trace_mod.get(conn, args.id)] if args.id else trace_mod.recent(conn, limit=args.last)
        )
        rows = [r for r in rows if r is not None]
        if not rows:
            print("no traces recorded yet; the daemon writes one per request")
            return 1

        for row in rows:
            when = datetime.fromtimestamp(row.ts).strftime("%Y-%m-%d %H:%M:%S")
            headline = row.skip_reason if row.skipped else (row.decision or "no gate")
            print(f"\n#{row.id}  {when}  [{headline}]  {row.latency_ms:.0f}ms")
            print(f"  prompt: {row.prompt[:110]}")
            if row.skipped:
                continue

            stages = row.stages or {}
            timings = stages.get("stage_ms") or {}
            print("  stages: " + "  ".join(f"{k}={v}ms" for k, v in timings.items()))
            flags = [
                f"dense={'on' if stages.get('dense_used') else 'off'}",
                f"reranked={'yes' if stages.get('reranked') else 'no'}",
                f"fell_back={'yes' if stages.get('fell_back') else 'no'}",
                f"candidates={stages.get('n_fused', 0)}",
                f"tokens={row.injected_tokens}",
            ]
            print("  " + "  ".join(flags))
            gate = stages.get("gate")
            if gate:
                print(
                    f"  gate: {gate['decision']} top={gate['top_score']} "
                    f"margin={gate['boundary_margin']}"
                )
            if not args.quiet:
                for rank, entry in enumerate(row.selected, start=1):
                    print(
                        f"    {rank}. {entry['path']}  model={entry['model_score']} "
                        f"rrf={entry['rrf']} dense#{entry['dense_rank']} "
                        f"sparse#{entry['sparse_rank']} hops={entry['ast_hops']}"
                    )
    finally:
        conn.close()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from .daemon import serve

    return serve(Config.load())


def cmd_embed(args: argparse.Namespace) -> int:
    from .embed import Embedder, embed_pending, pending_count

    repo = _resolve_repo(args.repo)
    cfg = Config.load(repo)
    conn = connect(repo)
    try:
        if args.reset:
            from .db import reset_dense, transaction

            with transaction(conn):
                reset_dense(conn)
            print("dense index reset", flush=True)
        pending = pending_count(conn)
        if pending == 0:
            print("nothing pending")
            return 0
        print(f"loading {cfg.embed.model_id} ...", flush=True)
        embedder = Embedder(
            cfg.embed.model_id,
            device=cfg.embed.device,
            max_seq_length=cfg.embed.max_seq_length,
            batch_size=cfg.embed.batch_size,
            trust_remote_code=cfg.embed.trust_remote_code,
        )
        print(f"device={embedder.device} dim={embedder.dim}, {pending} files pending", flush=True)

        def progress(done: int, total: int) -> None:
            if done % (cfg.embed.files_per_batch * 4) == 0 or done == total:
                print(f"  {done}/{total} files", flush=True)

        stats = embed_pending(
            repo,
            embedder,
            conn=conn,
            files_per_batch=cfg.embed.files_per_batch,
            limit=args.limit,
            min_chunk_tokens=cfg.embed.min_chunk_tokens,
            progress=progress,
        )
        print(stats)
    finally:
        conn.close()
    return 0


def cmd_query(args: argparse.Namespace) -> int:
    repo = _resolve_repo(args.repo)
    prompt = " ".join(args.prompt)

    if not args.local:
        from .daemon import DaemonUnavailable, request

        try:
            # rank=True asks the daemon to also return the pre-cut ranked candidates, so --rank
            # reuses its already-resident embedder/ranker instead of paying a cold local load.
            response = request(
                {"op": "retrieve", "repo": str(repo), "prompt": prompt, "rank": args.rank}
            )
        except DaemonUnavailable as exc:
            print(f"daemon unavailable ({exc}); falling back to --local", file=sys.stderr)
        else:
            if not response.get("ok"):
                print(f"error: {response.get('error')}", file=sys.stderr)
                return 1
            if args.rank and "fused" in response:
                _render_rank(
                    response["fused"],
                    len(response["paths"]),
                    response.get("reranked", False),
                    response.get("fell_back", False),
                )
            _print_query(response["paths"], response, args.show_context, response.get("context"))
            return 0

    from .retrieve import retrieve

    cfg = Config.load(repo)
    conn = connect(repo)
    embedder = None
    try:
        if args.dense:
            from .embed import Embedder

            embedder = Embedder(
                cfg.embed.model_id,
                device=cfg.embed.device,
                max_seq_length=cfg.embed.max_seq_length,
                batch_size=cfg.embed.batch_size,
            )
        ranker = _print_rank(repo, conn, prompt, cfg, embedder) if args.rank else None
        result = retrieve(repo, prompt, conn=conn, embedder=embedder, cfg=cfg, ranker=ranker)
        summary = {
            "dense_used": result.dense_used,
            "latency_ms": round(result.latency_ms, 2),
            "stage_ms": {k: round(v, 2) for k, v in result.stage_ms.items()},
            "tokens": result.context.tokens if result.context else 0,
        }
        _print_query(result.paths, summary, args.show_context,
                     result.context.text if result.context else "")
    finally:
        conn.close()
    return 0


def _render_rank(rows: list[dict], cutoff: int, reranked: bool, fell_back: bool = False) -> None:
    """Top-10 ranked candidates with their scores, cutoff marked where the selection was cut.

    Shared by the daemon path (rows come off the wire as dicts) and the local fallback path
    (rows are Candidate instances turned into dicts with dataclasses.asdict) so the two render
    identically.
    """
    if fell_back:
        # Decision 28: a LOW-confidence gate discards the model ranking outright and substitutes
        # ripgrep matches, whose "model_score" is a synthetic descending rank (fallback.py), not
        # the trained model's output. Label it as such or the table looks like a real score.
        label = "ripgrep fallback, gate rejected the model ranking"
    else:
        label = "model" if reranked else "rrf-only, no trained ranker found"
    print(f"rank ({label}):")
    for rank, c in enumerate(rows[:10], start=1):
        marker = " <-- selected" if rank <= cutoff else ""
        print(
            f"  {rank:2d}. {c['path']:<60s} rrf={c['rrf_score']:.4f} model={c['model_score']:.4f} "
            f"dense#{c['dense_rank']} sparse#{c['sparse_rank']}{marker}"
        )
        if rank == cutoff:
            print("      " + "-" * 60 + " cutoff")
    print()


def _print_rank(repo: Path, conn, prompt: str, cfg: Config, embedder):
    """Local fallback for --rank when the daemon is unavailable (or --local was passed).

    Loads the trained ranker the same way the daemon does (rank/scorer.py Ranker.load) and returns
    it, so the caller can rerank the real selection with the same ranker instead of the printed
    table disagreeing with what actually gets selected below it.
    """
    from dataclasses import asdict

    from .rank.scorer import Ranker
    from .retrieve.pipeline import generate_candidates, rerank as rerank_candidates

    ranker = Ranker.load(repo)
    generated = generate_candidates(conn, prompt, cfg=cfg, embedder=embedder)
    ordered = generated.candidates
    if ranker is not None:
        ordered = rerank_candidates(conn, prompt, ordered, ranker=ranker)

    _render_rank([asdict(c) for c in ordered], cfg.top_n, ranker is not None)
    return ranker


def _print_query(
    selected: list[str], summary: dict, show_context: bool, context: str | None
) -> None:
    for rank, path in enumerate(selected, start=1):
        print(f"  {rank}. {path}")
    stages = " ".join(f"{k}={v}ms" for k, v in (summary.get("stage_ms") or {}).items())
    print(
        f"dense={summary.get('dense_used')} tokens={summary.get('tokens')} "
        f"total={summary.get('latency_ms')}ms  {stages}"
    )
    if show_context and context:
        print("\n" + context)


def cmd_status(args: argparse.Namespace) -> int:
    repo = _resolve_repo(args.repo)
    db_file = paths.db_path(repo)
    if not db_file.exists():
        print(f"no index at {db_file}")
        return 1
    conn = connect(repo)
    try:
        one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
        print(f"index   {db_file} ({db_file.stat().st_size / 1e6:.1f} MB)")
        print(f"schema  v{schema_version(conn)}")
        print(
            f"files   {one('SELECT COUNT(*) FROM files')} indexed, "
            f"{one('SELECT COUNT(*) FROM files WHERE dense_ready = 1')} dense-ready"
        )
        print(f"chunks  {one('SELECT COUNT(*) FROM chunks')}")
        dense = dense_config(conn)
        print(f"dense   {dense[0] + ' @ ' + str(dense[1]) + 'd' if dense else 'not built'}")
        print(
            f"symbols {one('SELECT COUNT(*) FROM symbols')}, "
            f"imports {one('SELECT COUNT(*) FROM imports')}, "
            f"edges {one('SELECT COUNT(*) FROM edges')}"
        )
        by_lang = conn.execute(
            "SELECT lang, COUNT(*) FROM files GROUP BY lang ORDER BY 2 DESC"
        ).fetchall()
        for lang, count in by_lang:
            print(f"  {lang:<12} {count:>6}")
    finally:
        conn.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hybrid-retrieval")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor", help="check the local environment")
    doctor.set_defaults(func=cmd_doctor)

    scan = sub.add_parser("scan", help="enumerate indexable files without writing an index")
    scan.add_argument("repo", nargs="?", default=None)
    scan.set_defaults(func=cmd_scan)

    index_cmd = sub.add_parser("index", help="build or refresh the index")
    index_cmd.add_argument("repo", nargs="?", default=None)
    index_cmd.add_argument(
        "--watch", action="store_true", help="stay resident and re-index on file changes"
    )
    index_cmd.set_defaults(func=cmd_index)

    embed_cmd = sub.add_parser("embed", help="embed chunks the indexer marked pending")
    embed_cmd.add_argument("repo", nargs="?", default=None)
    embed_cmd.add_argument("--limit", type=int, default=None, help="stop after N files")
    embed_cmd.add_argument(
        "--reset", action="store_true", help="drop existing vectors first (needed to switch model)"
    )
    embed_cmd.set_defaults(func=cmd_embed)

    train_cmd = sub.add_parser("train", help="mine git history and train the reranker")
    train_cmd.add_argument("repo", nargs="?", default=None)
    train_cmd.add_argument("--holdout", type=int, default=200, help="newest N commits held out")
    train_cmd.add_argument("--max-commits", type=int, default=None)
    train_cmd.add_argument("--no-dense", action="store_true")
    train_cmd.set_defaults(func=cmd_train)

    sessions_cmd = sub.add_parser("sessions", help="summarise coding-agent session history")
    sessions_cmd.add_argument("--top", type=int, default=15)
    sessions_cmd.add_argument(
        "--sources", default=None, help="comma-separated subset, e.g. claude-code,pi"
    )
    sessions_cmd.set_defaults(func=cmd_sessions)

    ts = sub.add_parser("train-sessions", help="train the ranker on real prompts from transcripts")
    ts.add_argument("--max-repos", type=int, default=12)
    ts.add_argument(
        "--target",
        choices=("touched", "edited"),
        default="touched",
        help="'edited' is the strong signal, 'touched' also counts files Claude read",
    )
    ts.add_argument("--holdout-fraction", type=float, default=0.2)
    ts.add_argument("--sources", default=None, help="comma-separated subset of session sources")
    ts.add_argument("--index", action="store_true", help="index each repo first")
    ts.add_argument("--dense", action="store_true")
    ts.set_defaults(func=cmd_train_sessions)

    trace_cmd = sub.add_parser("trace", help="inspect what the pipeline did on recent queries")
    trace_cmd.add_argument("repo", nargs="?", default=None)
    trace_cmd.add_argument("--last", type=int, default=5)
    trace_cmd.add_argument("--id", type=int, default=None, help="one trace by id")
    trace_cmd.add_argument("--quiet", action="store_true", help="omit the selected files")
    trace_cmd.add_argument("--prune", action="store_true", help="delete expired traces")
    trace_cmd.add_argument("--days", type=int, default=30)
    trace_cmd.set_defaults(func=cmd_trace)

    serve_cmd = sub.add_parser("serve", help="run the resident daemon")
    serve_cmd.set_defaults(func=cmd_serve)

    stop_cmd = sub.add_parser("stop", help="shut the resident daemon down")
    stop_cmd.set_defaults(func=cmd_stop)

    dash = sub.add_parser("dashboard", help="web UI to inspect and configure the pipeline")
    dash.add_argument("--host", default="127.0.0.1", help="localhost only; there is no auth")
    dash.add_argument("--port", type=int, default=5111)
    dash.set_defaults(func=cmd_dashboard)

    query = sub.add_parser("query", help="retrieve for a prompt")
    query.add_argument("prompt", nargs="+")
    query.add_argument("--repo", default=None)
    query.add_argument("--local", action="store_true", help="bypass the daemon")
    query.add_argument("--dense", action="store_true", help="with --local, load the embedder")
    query.add_argument("--show-context", action="store_true", help="print the injected block")
    query.add_argument(
        "--rank",
        action="store_true",
        help="print the top-10 ranked candidates with rrf/model scores before the selection",
    )
    query.set_defaults(func=cmd_query)

    status = sub.add_parser("status", help="show index statistics")
    status.add_argument("repo", nargs="?", default=None)
    status.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
