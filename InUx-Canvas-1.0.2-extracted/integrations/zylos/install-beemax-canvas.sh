#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
SOURCE_DIR="$ROOT_DIR/beemax-canvas"

if [[ ! -f "$SOURCE_DIR/SKILL.md" ]]; then
  print -u2 "BeeMax Canvas Zylos component is missing: $SOURCE_DIR"
  exit 1
fi

if ! command -v zylos >/dev/null 2>&1; then
  print -u2 "Zylos CLI is required. Install Zylos first, then rerun this installer."
  exit 1
fi

zylos add "$SOURCE_DIR" --yes

TARGET_DIR="${ZYLOS_DIR:-${ZYLOS_HOME:-$HOME/zylos}}/.claude/skills/beemax-canvas"
print "BeeMax Canvas component registered with Zylos: $TARGET_DIR"
print "Verify inside Zylos or run: node '$TARGET_DIR/scripts/beemax.js' status"
print "Start a new Zylos session to reload the component."
