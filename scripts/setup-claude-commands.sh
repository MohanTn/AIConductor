#!/usr/bin/env bash
# setup-claude-commands.sh
#
# Copies AIConductor Claude commands into the target repository.
# Run this script from inside the root of any repository to set up
# the /refine-feature, /dev-workflow, and /bug-fix slash commands.
#
# Usage:
#   bash /path/to/task-review-manager/scripts/setup-claude-commands.sh
#   OR copy this script into the target repo and run:
#   bash setup-claude-commands.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_COMMANDS_DIR="$SCRIPT_DIR/../.claude/commands"
TARGET_DIR="$(pwd)/.claude/commands"

# Verify the source exists
if [[ ! -d "$SOURCE_COMMANDS_DIR" ]]; then
  echo "ERROR: Source commands directory not found at: $SOURCE_COMMANDS_DIR"
  echo "Make sure this script is inside the task-review-manager/scripts/ directory."
  exit 1
fi

# Verify we're not running inside the source repo itself
SOURCE_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
CURRENT_DIR="$(pwd)"
if [[ "$CURRENT_DIR" == "$SOURCE_REPO" ]]; then
  echo "ERROR: You are running this script inside the task-review-manager repo itself."
  echo "Navigate to the target repository first, then run this script."
  exit 1
fi

# Verify target is a git repository
if [[ ! -d "$(pwd)/.git" ]]; then
  echo "WARNING: Current directory does not appear to be a git repository: $CURRENT_DIR"
  read -r -p "Continue anyway? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Setting up AIConductor Claude commands..."
echo "  Source : $SOURCE_COMMANDS_DIR"
echo "  Target : $TARGET_DIR"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Track what was copied
copied=0
skipped=0

for src_file in "$SOURCE_COMMANDS_DIR"/*.md; do
  filename="$(basename "$src_file")"
  dest_file="$TARGET_DIR/$filename"

  if [[ -f "$dest_file" ]]; then
    read -r -p "  '$filename' already exists. Overwrite? [y/N] " overwrite
    if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
      echo "  Skipped: $filename"
      ((skipped++)) || true
      continue
    fi
  fi

  cp "$src_file" "$dest_file"
  echo "  Copied: $filename"
  ((copied++)) || true
done

echo ""
echo "Done. $copied file(s) copied, $skipped skipped."
echo ""
echo "Available slash commands in Claude Code:"
for f in "$TARGET_DIR"/*.md; do
  name="$(basename "$f" .md)"
  echo "  /$name"
done
