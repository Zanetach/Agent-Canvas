#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-canvas-update.XXXXXX")"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

make_fixture() {
  local name="$1"
  local fixture="$TEST_ROOT/$name"
  mkdir -p "$fixture/bin"
  cp "$ROOT_DIR/update.sh" "$fixture/update.sh"

  cat >"$fixture/bin/git" <<'EOF'
#!/bin/sh
printf 'git %s\n' "$*" >>"$UPDATE_TEST_LOG"
case "$*" in
  *"status --porcelain"*)
    printf '%s' "${UPDATE_TEST_STATUS:-}"
    ;;
  *"branch --show-current"*)
    printf '%s\n' main
    ;;
  *"remote get-url origin"*)
    printf '%s\n' https://github.com/Zanetach/Agent-Canvas.git
    ;;
esac
EOF
  cat >"$fixture/install-agent.sh" <<'EOF'
#!/bin/sh
printf 'install %s\n' "$*" >>"$UPDATE_TEST_LOG"
test "${AGENT_CANVAS_ALLOW_NO_AGENTS:-0}" = "1"
EOF
  cat >"$fixture/deploy.sh" <<'EOF'
#!/bin/sh
printf 'deploy %s\n' "$*" >>"$UPDATE_TEST_LOG"
EOF
  chmod +x "$fixture/bin/git" "$fixture/install-agent.sh" "$fixture/deploy.sh"
  printf '%s\n' "$fixture"
}

clean_fixture="$(make_fixture clean)"
clean_log="$clean_fixture/commands.log"
UPDATE_TEST_LOG="$clean_log" \
  AGENT_CANVAS_GIT_BIN="$clean_fixture/bin/git" \
  AGENT_CANVAS_SKIP_RUNNING_CHECK=1 \
  "$clean_fixture/update.sh" --no-open

grep -q '^git status --porcelain --untracked-files=normal$' "$clean_log"
grep -q '^git pull --ff-only origin main$' "$clean_log"
grep -q '^install all$' "$clean_log"
grep -q '^deploy --no-open$' "$clean_log"

dirty_fixture="$(make_fixture dirty)"
dirty_log="$dirty_fixture/commands.log"
if UPDATE_TEST_LOG="$dirty_log" \
  UPDATE_TEST_STATUS=' M local-change' \
  AGENT_CANVAS_GIT_BIN="$dirty_fixture/bin/git" \
  AGENT_CANVAS_SKIP_RUNNING_CHECK=1 \
  "$dirty_fixture/update.sh" --no-open >"$dirty_fixture/output.log" 2>&1; then
  echo "dirty update unexpectedly succeeded" >&2
  exit 1
fi

grep -q '检测到未提交修改' "$dirty_fixture/output.log"
if grep -q '^git pull ' "$dirty_log"; then
  echo "dirty update attempted to pull" >&2
  exit 1
fi

occupied_fixture="$(make_fixture occupied)"
occupied_log="$occupied_fixture/commands.log"
cat >"$occupied_fixture/bin/curl" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"$occupied_fixture/bin/lsof" <<'EOF'
#!/bin/sh
printf '%s\n' "$UPDATE_TEST_LISTENER_PID"
EOF
chmod +x "$occupied_fixture/bin/curl" "$occupied_fixture/bin/lsof"
if PATH="$occupied_fixture/bin:$PATH" \
  UPDATE_TEST_LOG="$occupied_log" \
  UPDATE_TEST_LISTENER_PID="$$" \
  AGENT_CANVAS_GIT_BIN="$occupied_fixture/bin/git" \
  "$occupied_fixture/update.sh" --no-open >"$occupied_fixture/output.log" 2>&1; then
  echo "unknown running service update unexpectedly succeeded" >&2
  exit 1
fi

grep -q '不属于当前仓库，拒绝停止' "$occupied_fixture/output.log"
if grep -q '^deploy ' "$occupied_log"; then
  echo "occupied update attempted to deploy over an unknown process" >&2
  exit 1
fi

echo "PASS Agent Canvas one-click updater"
