"""Break-even analysis over Tier 2 pilot data (BENCHMARK.md section 3).

The question this answers: how large can an injection be before it costs more than the discovery
it saves? Everything is in input-token-equivalents, so the answer holds regardless of model.

    injection cost over K turns  =  T_inj * (r_cw + (K-1) * r_cr)
    saving per avoided discovery =  r_cr * C_avg  +  r_out * O_tool  +  the tool result itself

Setting them equal gives the largest injection that can break even. If the measured payload is
above that line, no amount of ranking improvement rescues it: the delivery mechanism is wrong.

    uv run python bench/breakeven.py docs/benchmarks/tier2-pilot.json
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

RATIOS = {"cache_read": 0.1, "cache_write": 1.25, "output": 5.0}

# Rough size of a tool call's own output and the result it returns, in tokens.
TOOL_CALL_OUTPUT = 120
TOOL_RESULT_TOKENS = 900


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/benchmarks/tier2-pilot.json")
    data = json.loads(path.read_text())
    rows = data["rows"]
    ratios = data.get("ratios", RATIOS)

    base = [r for r in rows if r["arm"] == "baseline"]
    treat = [r for r in rows if r["arm"] == "treatment"]
    if not base or not treat:
        print("need both arms", file=sys.stderr)
        return 1

    med = statistics.median
    turns = med([r["turns"] for r in base])
    discovery = med([r["discovery_calls"] for r in base])
    # Average live context per turn: total cache reads spread over the turns that read them.
    cache_read = med([r["cache_read_tokens"] for r in base])
    context_per_turn = cache_read / max(turns - 1, 1)

    print(f"baseline, median over {len(base)} runs")
    print(f"  turns                {turns:.0f}")
    print(f"  discovery calls      {discovery:.0f}")
    print(f"  context per turn     {context_per_turn:,.0f} tokens")
    print(f"  ITE                  {med([r['ite'] for r in base]):,.0f}")
    print(f"treatment ITE          {med([r['ite'] for r in treat]):,.0f}")

    # What one avoided discovery round trip is worth.
    per_discovery = (
        ratios["cache_read"] * context_per_turn
        + ratios["output"] * TOOL_CALL_OUTPUT
        + TOOL_RESULT_TOKENS * (ratios["cache_write"] + (turns / 2) * ratios["cache_read"])
    )
    saving = per_discovery * discovery

    # What one injected token costs across the whole session.
    per_token = ratios["cache_write"] + (turns - 1) * ratios["cache_read"]
    breakeven = saving / per_token

    print("\nbreak-even")
    print(f"  value of one avoided discovery   {per_discovery:,.0f} ITE")
    print(f"  discoveries available to avoid   {discovery:.0f}")
    print(f"  total saving available           {saving:,.0f} ITE")
    print(f"  cost of one injected token       {per_token:.2f} ITE")
    print(f"  -> largest injection that pays   {breakeven:,.0f} tokens")

    print("\npayload options against that line")
    for label, tokens in (
        ("ranked pointers (5 files)", 400),
        ("symbol spans (5 files)", 1750),
        ("full files, typical", 4800),
        ("full files, worst seen", 103_344),
    ):
        verdict = "fits" if tokens <= breakeven else "cannot break even"
        print(f"  {label:<28} {tokens:>7,} tokens   {verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
