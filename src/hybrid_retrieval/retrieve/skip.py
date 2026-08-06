"""Skip predicate (decision 31).

The hook fires on every prompt, including "run the tests" and "yes". Under decision 30 the payload
is uncapped full file contents, so a no-op firing is not free — it is thousands of tokens and a
context window full of code nobody asked about.

Cheap rules only: length, slash commands, continuations, and pure questions about the conversation
rather than the code. No model, no retrieval, no database.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..config import SkipConfig
from ..text import query_terms

# Prompts that are about the exchange rather than the codebase.
_META_PATTERNS = (
    r"^(what|why|how) (did|do) you\b",
    r"^(explain|summarise|summarize) (that|this|it)\b",
    r"^(thanks|thank you|nice|great|perfect)\b",
)


@dataclass(frozen=True, slots=True)
class SkipDecision:
    skip: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.skip


def _compile(patterns: list[str]) -> list[re.Pattern]:
    compiled = []
    for raw in patterns:
        try:
            compiled.append(re.compile(raw, re.IGNORECASE))
        except re.error:
            continue  # a bad pattern in config must not break every prompt
    return compiled


def should_skip(prompt: str, cfg: SkipConfig | None = None) -> SkipDecision:
    """Decide whether this prompt is worth retrieving for.

    The load-bearing rule is the last one: how many usable search terms survive stopword removal.
    A prompt with fewer than two has nothing to retrieve on regardless of how long it is, and a
    short prompt full of identifiers has plenty.
    """
    cfg = cfg or SkipConfig()
    stripped = prompt.strip()

    if not stripped:
        return SkipDecision(True, "empty")
    # Patterns first so the reason names the actual cause: "/clear" is a slash command, not a
    # short string, and the trace is only useful if it says which rule fired.
    for pattern in _compile(cfg.patterns):
        if pattern.search(stripped):
            return SkipDecision(True, f"matched {pattern.pattern!r}")
    for pattern in _META_PATTERNS:
        if re.search(pattern, stripped, re.IGNORECASE):
            return SkipDecision(True, "about the conversation, not the code")
    if len(stripped) < cfg.min_prompt_chars:
        return SkipDecision(True, f"shorter than {cfg.min_prompt_chars} chars")

    terms = query_terms(stripped)
    if len(terms) < cfg.min_query_terms:
        return SkipDecision(True, f"only {len(terms)} usable search term(s)")
    return SkipDecision(False)
