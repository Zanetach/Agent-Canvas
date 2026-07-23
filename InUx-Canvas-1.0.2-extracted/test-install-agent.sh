#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
FIXTURE_BIN="$ROOT_DIR/bridge/fixtures/installer-bin"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-canvas-installer.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT INT TERM

export BEEMAX_NODE="$(command -v node)"
export HOME="$TEST_DIR/home"
export INSTALLER_TEST_LOG="$TEST_DIR/installer.log"
export PATH="$FIXTURE_BIN:/usr/bin:/bin"
export CODEX_BIN="$FIXTURE_BIN/codex"
export HERMES_PYTHON="$FIXTURE_BIN/hermes-python"
mkdir -p "$HOME"

: >"$INSTALLER_TEST_LOG"
"$ROOT_DIR/install-agent.sh" codex
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"
if grep -q '^codex login$' "$INSTALLER_TEST_LOG"; then
  print -u2 "installer must not start an interactive Codex login"
  exit 1
fi

: >"$INSTALLER_TEST_LOG"
if INSTALLER_CODEX_STATUS=1 "$ROOT_DIR/install-agent.sh" codex \
  >"$TEST_DIR/codex-unconfigured.log" 2>&1; then
  print -u2 "unconfigured Codex CLI should not be reported as ready"
  exit 1
fi
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"
if grep -q '^codex login$' "$INSTALLER_TEST_LOG"; then
  print -u2 "headless installer must not start an interactive Codex login"
  exit 1
fi
grep -q '不会自动启动浏览器登录' "$TEST_DIR/codex-unconfigured.log"

: >"$INSTALLER_TEST_LOG"
BEEMAX_CODEX_PROVIDER_COMMAND_JSON="[\"$CODEX_BIN\"]" \
  INSTALLER_CODEX_STATUS=1 \
  "$ROOT_DIR/install-agent.sh" codex >"$TEST_DIR/codex-command-provider.log"
test ! -s "$INSTALLER_TEST_LOG"
grep -q 'Codex 生图命令 Provider' "$TEST_DIR/codex-command-provider.log"

: >"$INSTALLER_TEST_LOG"
if BEEMAX_CODEX_PROVIDER_COMMAND_JSON='not-json' \
  "$ROOT_DIR/install-agent.sh" codex >"$TEST_DIR/codex-invalid-provider.log" 2>&1; then
  print -u2 "invalid command provider JSON should fail"
  exit 1
fi
grep -q 'Provider 配置无效' "$TEST_DIR/codex-invalid-provider.log"

if BEEMAX_CODEX_PROVIDER_COMMAND_JSON='["/missing/codex-image-provider"]' \
  "$ROOT_DIR/install-agent.sh" codex >"$TEST_DIR/codex-missing-provider.log" 2>&1; then
  print -u2 "missing command provider executable should fail"
  exit 1
fi
grep -q '入口不可执行' "$TEST_DIR/codex-missing-provider.log"

if BEEMAX_CODEX_PROVIDER_COMMAND_JSON="[\"$CODEX_BIN\"]" \
  BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON='[]' \
  "$ROOT_DIR/install-agent.sh" codex >"$TEST_DIR/codex-invalid-capabilities.log" 2>&1; then
  print -u2 "non-object command provider capabilities should fail"
  exit 1
fi
grep -q '能力声明必须是 JSON 对象' "$TEST_DIR/codex-invalid-capabilities.log"

: >"$INSTALLER_TEST_LOG"
if BEEMAX_AGENT_GATEWAY_URL='http://127.0.0.1:19000' \
  BEEMAX_AGENT_MODELS_JSON='{"image":["codex-image"],"text":[],"video":[]}' \
  INSTALLER_CODEX_STATUS=1 \
  "$ROOT_DIR/install-agent.sh" codex >"$TEST_DIR/codex-unregistered-gateway.log" 2>&1; then
  print -u2 "gateway environment alone must not be reported as a registered Codex provider"
  exit 1
fi
grep -q '^codex login status$' "$INSTALLER_TEST_LOG"
if grep -q '^codex login$' "$INSTALLER_TEST_LOG"; then
  print -u2 "unregistered gateway fallback must not start Codex login"
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
BEEMAX_CODEX_PROVIDER_COMMAND_JSON="[\"$CODEX_BIN\"]" \
  INSTALLER_CODEX_STATUS=1 \
  "$ROOT_DIR/install-agent.sh" all
if grep -q '^codex login' "$INSTALLER_TEST_LOG"; then
  print -u2 "all mode must reuse the configured provider without Codex login"
  exit 1
fi
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
BEEMAX_CODEX_PROVIDER_COMMAND_JSON="[\"$CODEX_BIN\"]" \
  INSTALLER_CODEX_STATUS=1 \
  "$ROOT_DIR/install-agent.sh"
if grep -q '^codex login' "$INSTALLER_TEST_LOG"; then
  print -u2 "default all mode must not start Codex login"
  exit 1
fi
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
