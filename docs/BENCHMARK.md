# Benchmark Plan — proving the pipeline saves tokens and time

Companion to `docs/SPEC.md`. This document is **pre-registered**: the hypotheses, thresholds and
kill criteria below are fixed before any code is written, so the result cannot be rationalised
after the fact.

---

## 1. The claim under test

> Injecting the right files up front costs fewer tokens and less wall-clock time than letting the
> agent find them itself, without reducing task success.

This is not obviously true. Under decision 30 the pipeline injects **uncapped full file contents
on every prompt**. That is a real, guaranteed, up-front cost paid against a probabilistic saving.
The benchmark exists to find out which is bigger, and it is designed so it can return "the
pipeline loses".

## 2. Why "tokens injected" is the wrong accounting

The naive comparison — "we added 4k tokens, therefore we cost 4k tokens more" — is wrong in both
directions, because an agentic loop re-sends its entire context on every turn.

Three facts drive the real economics:

1. **Injected tokens are paid K times, not once.** With `K` assistant turns, the injection is
   cache-written once and cache-read on every subsequent turn.
2. **A discovery round trip costs far more than the bytes it returns.** Each `Grep`→`Read` step is
   an extra assistant turn: output tokens for the tool call, the tool result appended to context
   forever, *and* a full re-read of the context at cache-read price, plus one full model
   round trip of latency.
3. **Files the agent would have read anyway are paid in both arms.** They are not savings. The
   savings come from (a) search turns eliminated, (b) files read and discarded, (c) round trips.

**Consequence: precision, not recall, is the economic metric.** An injected file the agent never
touches is pure loss, charged on every turn. This is why §7 measures wasted injected tokens.

## 3. Cost algebra and the break-even point

Work in **input-token-equivalents (ITE)**: cost in units of one uncached input token.

Let `r_cr`, `r_cw`, `r_out` be the price ratios of cache-read, cache-write and output tokens to
uncached input tokens. **Fill these from current published pricing at report time; do not hardcode
them from memory.**

Per assistant turn:

```
ITE_t = input_t + r_cw·cache_creation_t + r_cr·cache_read_t + r_out·output_t
```

Treatment's extra cost for an injection of `T_inj` tokens over `K` turns:

```
Extra = T_inj · (r_cw + (K-1)·r_cr)
```

Treatment's saving from eliminating `D` discovery steps, where step `d` emitted `O_d` output
tokens, returned `S_d` tool-result tokens, and occurred when the context was `C_d` tokens:

```
Saved = Σ_d [ r_out·O_d  +  r_cr·C_d  +  S_d·(r_cw + (K-d-1)·r_cr) ]
```

**Break-even injection size:**

```
T_inj* = Saved / (r_cw + (K-1)·r_cr)
```

`T_inj*` is computed from *observed* baseline runs in §9 and reported as a headline number: it is
the largest injection that can possibly pay for itself on this workload. If the measured median
`T_inj` under decision 30 exceeds `T_inj*`, decision 30 is falsified — that is kill criterion K1.

**Latency model.** Wall clock is dominated by round trips, not bytes: each eliminated turn saves a
full model call (typically seconds), while the hook adds ≤3s once and prefill of a large injection
adds sub-second to low-seconds. Eliminating even one round trip is usually a net latency win, so
H3 is the easiest hypothesis to satisfy and the least interesting on its own.

## 4. Hypotheses

| ID | Hypothesis | Threshold | Test |
|---|---|---|---|
| H1 | Total ITE per task is lower with the pipeline | median ratio ≤ 0.70 | Tier 2 |
| H2 | Fewer discovery tool calls before the first surviving edit | median reduction ≥ 40% | Tier 2 |
| H3 | Lower wall clock to task completion | median reduction ≥ 25% | Tier 2 |
| H4 | Task success does not regress | non-inferior, margin 5pp | Tier 2 |
| H5 | Retrieval beats a ripgrep baseline | recall@5 ≥ baseline + 15pp | Tier 1 |
| H6 | Injected context is mostly used | precision@5 ≥ 0.50 | Tier 2 |
| H7 | Hook latency stays in budget | p95 ≤ 3000ms | Tier 1 |

H1 and H4 are the ship gate. H6 is the early-warning signal: if precision is low, H1 will fail.

## 5. Tier 1 — offline retrieval benchmark

Cheap, deterministic, no API calls, runs in CI on every commit.

**Data.** The last 200 commits of each target repo, held out from the label-mining training set.
Exclude merges, and bulk commits touching >15 files (renames, formatting, dependency bumps).
Query = commit subject plus first body line. Gold set = files changed by that commit.

**Systems compared.**

| Arm | Description |
|---|---|
| B0 | ripgrep on identifiers extracted from the query (the honest "what you'd do anyway" baseline) |
| B1 | BM25 only |
| B2 | Dense only |
| B3 | RRF fusion, no scorer |
| B4 | RRF + AST boost, no scorer |
| B5 | Full pipeline (RRF + AST + LightGBM reranker + gate) |

**Metrics.** recall@1/5/10, MRR, nDCG@10, plus per-stage latency p50/p95/p99 and index size on
disk. Broken down by language once more than one adapter exists.

**CI gate.** Fails the build on a >3pp recall@5 regression against the stored baseline.

**Known limitation.** Commit messages are terse, past-tense and pronoun-free; real prompts are
not. Tier 1 measures ranking quality, never end-user value. That is Tier 2's job.

## 6. Tier 2 — end-to-end A/B

The actual proof. Two arms, identical task, identical repo state.

- **Arm A (baseline):** stock Claude Code, hook disabled.
- **Arm B (treatment):** hook enabled, index pre-warmed.

**Harness.** `claude -p "<task>" --output-format json`, one process per run, with the arm selected
by a distinct settings file. Verify the exact flag names against the installed CLI before relying
on them; if headless JSON output is unavailable, fall back to parsing the session transcript,
which carries everything needed anyway (§8).

**Repetitions.** n = 5 per (task, arm). Model output is non-deterministic, so single runs prove
nothing. Arms are interleaved and task order randomised to spread drift in model or network
conditions across both arms.

## 7. Task suite

15-20 tasks minimum for statistical power, across at least two repos, tagged by category. Each
task ships with a machine-checkable success criterion (a test command, or a rubric checking that
a specific symbol exists and the build passes) and a gold file set for precision/recall.

| Category | Example | What it probes |
|---|---|---|
| Identifier-anchored | "Add refresh token rotation to `JwtService`" | The pipeline's best case; grep also does well here |
| Conceptual | "Improve error handling across the API layer" | Dense retrieval's justification; the LOW→grep path's known weakness |
| Cross-file | "Rename `IUserStore` and update all callers" | AST edges earning their keep |
| Novel file | "Add a health-check endpoint" | Retrieval has no gold target; measures harm, not help |
| Deep-dependency | "Fix the null ref in the token refresh path" | Multi-hop discovery, where baseline burns the most turns |
| Negative control | "Run the tests" | The skip rule must fire; any injection here is pure waste |

Negative controls are load-bearing. They quantify the cost of the pipeline on turns where it
should do nothing, which is a large fraction of real usage.

## 8. Measurement substrate

Confirmed present on this machine. Session transcripts at
`~/.claude/projects/<encoded-repo-path>/<session-id>.jsonl`, one JSON object per line.

Assistant messages carry:

```json
"usage": { "input_tokens": 10, "cache_creation_input_tokens": 11855,
           "cache_read_input_tokens": 13476, "output_tokens": 243 }
```

plus an ISO-8601 `timestamp`. That gives, per run:

- **ITE** — sum over assistant messages using the §3 formula.
- **Wall clock** — last timestamp minus first; per-turn latency from consecutive deltas.
- **Turn count** — number of assistant messages.
- **Discovery tool calls** — `tool_use` blocks named `Glob`/`Grep`/`Read`/`Bash(rg…)` occurring
  before the first `Edit`/`Write` that survives into the final diff.
- **Tool-result size** — token estimate of `tool_result` content in user messages.
- **Files touched** — paths from `Edit`/`Write` blocks, for precision/recall against the gold set.

The daemon's own `traces` table supplies the treatment arm's injected file list, injected token
count, gate decision and per-stage latency. Joining the two on session id gives **wasted injected
tokens**: injected files that were never read or edited.

## 9. Controls

Every one of these is a way to accidentally publish a false result.

- Fresh `git worktree` per run, hard-reset to a fixed commit. No state leaks between runs.
- Pinned model version, recorded in the report. A model change invalidates cross-date comparison.
- Identical `CLAUDE.md`, identical permission allowlist in both arms. Permission prompts stall the
  clock and would corrupt H3.
- Web search and all other hooks disabled in both arms.
- Index pre-warmed in Arm B before the timer starts. **Cold start is measured separately** and
  reported separately; folding it in would understate steady-state value.
- Record CLI version, index schema version, reranker model version, GPU, and price ratios used.
- Baseline `T_inj*` computed from Arm A runs *before* looking at Arm B token totals.

## 10. Statistics

Per-task medians over the 5 repetitions, then paired comparison **across tasks** (Wilcoxon
signed-rank), because runs within a task are independent samples but tasks are the paired unit.

Report the **median ratio** treatment/baseline with a bootstrap 95% CI, not the mean — token
distributions have heavy right tails and means will be dominated by one runaway session. Report
per-category breakdowns; an aggregate win driven entirely by identifier-anchored tasks while
conceptual tasks regress is a finding, not a success.

## 11. Ablations

Reduced to n = 3, run once at M5. These decide the open questions in the spec.

| ID | Variant | Question it answers |
|---|---|---|
| A1 | Payload = ranked pointers | Is full-file injection worth it at all? |
| A2 | Payload = full files (shipped default) | — |
| A3 | Payload = chunk spans | Is there a better middle? |
| A4 | `max_tokens = 8000` | Does capping help or hurt? |
| A5 | No scorer (RRF + AST only) | Does the LightGBM model earn its complexity? |
| A6 | No AST boost | Does structural expansion earn its four resolvers? |
| A7 | Gate disabled, always inject | Is the gate doing anything? |

A5 and A6 are the ones that could delete large parts of the system. Run them honestly.

## 12. Reporting

`docs/benchmarks/<YYYY-MM-DD>/report.md`, generated by `bench/report.py`, containing:

1. Headline table: ITE, wall clock, turns, success rate — baseline vs treatment, median ratio, CI.
2. The computed break-even `T_inj*` next to the observed median `T_inj`. This single comparison is
   the clearest statement of whether the design pays for itself.
3. Per-category breakdown.
4. Precision@5, recall@5, wasted-injected-tokens distribution.
5. Tier 1 table across arms B0-B5.
6. Ablation table.
7. Environment block: model, versions, price ratios, hardware.

Raw per-run JSON is committed alongside the report so any number can be recomputed.

## 13. Kill criteria

Pre-registered. If one triggers, the corresponding decision is reversed, not argued with.

- **K1** — observed median `T_inj` > break-even `T_inj*`, or median ITE ratio > 1.0 on ≥60% of
  tasks → decision 30 (uncapped) is falsified. Turn the cap on, or switch to the ablation winner.
- **K2** — success rate regresses more than 5pp → ship blocked regardless of any token win. A
  cheaper agent that fails more often is not an improvement.
- **K3** — Tier 1 B5 fails to beat B0 (ripgrep) by ≥15pp recall@5 → the ML stack is not earning
  its place; ship the sparse + AST path and delete the scorer.
- **K4** — p95 hook latency > 3000ms with a warm index → violates the design budget; reduce
  `dense_k`/`fuse_to` or move to binary quantization.
- **K5** — negative-control tasks show any injection → the skip rule is broken; fix before any
  other measurement is trustworthy.

## 14. Deliverables

```
bench/
  tier1_eval.py        # offline retrieval metrics, CI entrypoint
  tier2_runner.py      # worktree setup, arm selection, run loop
  parse_transcript.py  # jsonl -> per-run metrics
  breakeven.py         # §3 algebra over observed baseline runs
  report.py            # markdown + charts
  tasks/*.yaml         # task suite with success criteria and gold sets
```
