#!/usr/bin/env bash
# clean-test-artifacts.sh
# Removes orphaned test database files and directories from the project root.
# Safe to run multiple times (idempotent). Does NOT touch tasks.db.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOVED=0

echo "Scanning for test artifacts in: $REPO_ROOT"

# Patterns created by each test suite
PATTERNS=(
  "test-all-tools-*.db"
  "test-multirepo-*.db"
  "test-dashboard-api-*.db"
  "test-dev-queue-*.db"
)

for pattern in "${PATTERNS[@]}"; do
  for entry in "$REPO_ROOT"/$pattern; do
    [ -e "$entry" ] || continue          # no match → skip
    if [ -d "$entry" ]; then
      rm -rf "$entry"
      echo "  removed dir:  $entry"
      REMOVED=$((REMOVED + 1))
    elif [ -f "$entry" ]; then
      rm -f "$entry"
      echo "  removed file: $entry"
      REMOVED=$((REMOVED + 1))
    fi
  done
done

if [ "$REMOVED" -eq 0 ]; then
  echo "Nothing to clean."
else
  echo "Done. Removed $REMOVED artifact(s)."
fi
