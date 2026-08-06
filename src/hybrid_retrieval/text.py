"""Text normalisation shared by indexing and querying.

Both sides must split identifiers the same way or the query will not match the index.
"""

from __future__ import annotations

import re

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")

# Words that appear in almost every prompt and match almost every file.
_STOPWORDS = frozenset(
    """
    a an the and or but if then else for while of to in on at by with from as is are was were be
    been being do does did doing have has had having i you it this that these those please can
    could should would will shall may might must not no yes add update change make create new
    fix use using also more some any all we our your me my
    look take again another thing things stuff check here there now just really very
    """.split()  # noqa: SIM905 - readability beats a 500-character list literal
)


def split_identifier(word: str) -> list[str]:
    """RotateRefreshToken -> [rotate, refresh, token]; snake_case and kebab handled too."""
    parts: list[str] = []
    for piece in word.replace("-", "_").split("_"):
        if piece:
            parts.extend(p.lower() for p in _CAMEL_BOUNDARY.split(piece) if p)
    return parts


def identifier_text(source: str) -> str:
    """Space-joined split form of every identifier in a blob of code."""
    out: list[str] = []
    for match in _IDENTIFIER.finditer(source):
        word = match.group(0)
        parts = split_identifier(word)
        if len(parts) > 1:  # compounds only; single words are already in the content column
            out.extend(parts)
    return " ".join(out)


def query_terms(prompt: str, *, keep_stopwords: bool = False) -> list[str]:
    """Search terms for a natural-language prompt, order-preserving and de-duplicated."""
    terms: list[str] = []
    seen: set[str] = set()
    for match in _IDENTIFIER.finditer(prompt):
        word = match.group(0)
        candidates = [word.lower(), *split_identifier(word)]
        for term in candidates:
            if len(term) < 2 or term in seen:
                continue
            if not keep_stopwords and term in _STOPWORDS:
                continue
            seen.add(term)
            terms.append(term)
    return terms


def fts_match_query(terms: list[str]) -> str:
    """An FTS5 MATCH expression. Terms are quoted so punctuation cannot become syntax."""
    return " OR ".join(f'"{term}"' for term in terms if term)
