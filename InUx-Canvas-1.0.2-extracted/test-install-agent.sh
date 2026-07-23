#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
FIXTURE_BIN="$ROOT_DIR/bridge/fixtures/installer-bin"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-canvas-installer.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT INT TERM

export HOME="$TEST_DIR/home"
export INSTALLER_TEST_LOG="$TEST_DIR/installer.log"
export PATH="$FIXTURE_BIN:/usr/bin:/bin"
export CODEX_BIN="$FIXTURE_BIN/codex"
export HERMES_PYTHON="$FIXTURE_BIN/hermes-python"
mkdir -p "$HOME"

: >"$INSTALLER_TEST_LOG"
"$ROOT_DIR/install-agent.sh" codex
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"

: >"$INSTALLER_TEST_LOG"
INSTALLER_CODEX_STATUS=1 "$ROOT_DIR/install-agent.sh" codex
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"
grep -q '^codex login$' "$INSTALLER_TEST_LOG"

if INSTALLER_CODEX_STATUS=1 INSTALLER_CODEX_LOGIN_STATUS=1 \
  "$ROOT_DIR/install-agent.sh" codex >"$TEST_DIR/codex-failure.log" 2>&1; then
  print -u2 "failed Codex login should fail"
  exit 1
fi

: >"$INSTALLER_TEST_LOG"
"$ROOT_DIR/install-agent.sh" hermes
test -f "$HOME/.hermes/plugins/beemax-canvas/plugin.yaml"
test ! -e "$HOME/.hermes/plugins/beemax-canvas/__pycache__"
grep -q 'hermes-python -m hermes_cli.main plugins enable beemax-canvas' "$INSTALLER_TEST_LOG"

if INSTALLER_HERMES_STATUS=1 "$ROOT_DIR/install-agent.sh" hermes >"$TEST_DIR/hermes-failure.log" 2>&1; then
  print -u2 "failed Hermes enable should fail"
  exit 1
fi

: >"$INSTALLER_TEST_LOG"
"$ROOT_DIR/install-agent.sh" zylos
grep -q 'zylos add .*integrations/zylos/beemax-canvas --yes' "$INSTALLER_TEST_LOG"

if INSTALLER_ZYLOS_STATUS=1 "$ROOT_DIR/install-agent.sh" zylos >"$TEST_DIR/zylos-failure.log" 2>&1; then
  print -u2 "failed Zylos registration should fail"
  exit 1
fi

: >"$INSTALLER_TEST_LOG"
"$ROOT_DIR/install-agent.sh" all
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"
grep -q 'hermes-python -m hermes_cli.main plugins enable beemax-canvas' "$INSTALLER_TEST_LOG"
grep -q 'zylos add .*integrations/zylos/beemax-canvas --yes' "$INSTALLER_TEST_LOG"

: >"$INSTALLER_TEST_LOG"
if INSTALLER_HERMES_STATUS=1 "$ROOT_DIR/install-agent.sh" all >"$TEST_DIR/all-failure.log" 2>&1; then
  print -u2 "failed Agent in all mode should fail"
  exit 1
fi
grep -q 'Hermes 安装失败' "$TEST_DIR/all-failure.log"
grep -q 'Zylos 组件安装完成' "$TEST_DIR/all-failure.log"

: >"$INSTALLER_TEST_LOG"
"$ROOT_DIR/install-agent.sh"
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"
grep -q 'hermes-python -m hermes_cli.main plugins enable beemax-canvas' "$INSTALLER_TEST_LOG"
grep -q 'zylos add .*integrations/zylos/beemax-canvas --yes' "$INSTALLER_TEST_LOG"

if HERMES_PYTHON="$TEST_DIR/missing-python" \
  "$ROOT_DIR/install-agent.sh" hermes >"$TEST_DIR/missing.log" 2>&1; then
  print -u2 "missing Hermes should fail"
  exit 1
fi
grep -q '当前环境未检测到 Hermes' "$TEST_DIR/missing.log"

if "$ROOT_DIR/install-agent.sh" unknown >"$TEST_DIR/unknown.log" 2>&1; then
  print -u2 "unknown Agent should fail"
  exit 1
fi
grep -q 'codex|hermes|zylos|all' "$TEST_DIR/unknown.log"

print "PASS Agent Canvas one-click installer"
