"""Git history access, used for training labels and for recency features (decision 25).

The whole log is parsed once into memory. Everything downstream needs *point-in-time* answers —
"what did this file look like before commit C" — because computing recency or churn at HEAD while
training on commit C leaks the label straight into the features: a file is "recently touched"
precisely because the commit we are trying to predict touched it.
"""

from __future__ import annotations

import bisect
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

RECORD_SEP = "\x1e"
FIELD_SEP = "\x1f"

# A commit touching more than this is a rename sweep, a formatting pass or a dependency bump.
# Its message says nothing useful about any individual file.
DEFAULT_MAX_FILES = 15


@dataclass(frozen=True, slots=True)
class Commit:
    sha: str
    timestamp: int
    subject: str
    files: tuple[str, ...]


@dataclass
class History:
    commits: list[Commit] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.commits.sort(key=lambda c: c.timestamp)
        self._times = [c.timestamp for c in self.commits]
        self._by_path: dict[str, list[int]] = {}
        for commit in self.commits:
            for path in commit.files:
                self._by_path.setdefault(path, []).append(commit.timestamp)
        for stamps in self._by_path.values():
            stamps.sort()

    def __len__(self) -> int:
        return len(self.commits)

    def last_touched_before(self, path: str, before: int) -> int | None:
        """Timestamp of the newest commit touching ``path`` strictly before ``before``."""
        stamps = self._by_path.get(path)
        if not stamps:
            return None
        index = bisect.bisect_left(stamps, before)
        return stamps[index - 1] if index else None

    def churn_between(self, path: str, start: int, end: int) -> int:
        """How many commits touched ``path`` in [start, end)."""
        stamps = self._by_path.get(path)
        if not stamps:
            return 0
        return bisect.bisect_left(stamps, end) - bisect.bisect_left(stamps, start)

    def eligible(
        self,
        *,
        max_files: int = DEFAULT_MAX_FILES,
        keep: Iterable[str] | None = None,
        min_subject_words: int = 3,
    ) -> list[Commit]:
        """Commits usable as training examples.

        ``keep`` restricts to files that still exist in the index; a commit whose files have all
        since been deleted teaches nothing about the current repo.
        """
        allowed = set(keep) if keep is not None else None
        out: list[Commit] = []
        for commit in self.commits:
            if len(commit.files) > max_files or not commit.files:
                continue
            if len(commit.subject.split()) < min_subject_words:
                continue
            files = (
                tuple(f for f in commit.files if f in allowed)
                if allowed is not None
                else commit.files
            )
            if files:
                out.append(
                    Commit(
                        sha=commit.sha,
                        timestamp=commit.timestamp,
                        subject=commit.subject,
                        files=files,
                    )
                )
        return out


def _parse(raw: str) -> list[Commit]:
    commits: list[Commit] = []
    for block in raw.split(RECORD_SEP):
        block = block.strip("\n")
        if not block:
            continue
        header, _, body = block.partition("\n")
        parts = header.split(FIELD_SEP)
        if len(parts) < 3:
            continue
        sha, timestamp, subject = parts[0], parts[1], FIELD_SEP.join(parts[2:])
        try:
            when = int(timestamp)
        except ValueError:
            continue
        files = tuple(line for line in body.split("\n") if line.strip())
        commits.append(Commit(sha=sha, timestamp=when, subject=subject.strip(), files=files))
    return commits


def load_history(repo_root: Path | str, *, limit: int | None = None) -> History:
    """Parse the full commit log. Merges are excluded: their messages describe branches."""
    command = [
        "git",
        "log",
        "--no-merges",
        "-M",
        f"--pretty=format:{RECORD_SEP}%H{FIELD_SEP}%ct{FIELD_SEP}%s",
        "--name-only",
    ]
    if limit is not None:
        command.insert(2, f"-n{limit}")
    try:
        proc = subprocess.run(
            command, cwd=str(repo_root), capture_output=True, timeout=300, check=True
        )
    except (OSError, subprocess.SubprocessError):
        return History([])
    return History(_parse(proc.stdout.decode("utf-8", "replace")))
