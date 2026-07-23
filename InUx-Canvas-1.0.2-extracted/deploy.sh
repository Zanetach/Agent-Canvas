#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_URL="${BEEMAX_PUBLIC_ORIGIN:-http://127.0.0.1:${BEEMAX_BRIDGE_PORT:-17851}}"
FRONTEND_DIR="$ROOT_DIR/backend/_internal/frontend/dist"
PLUGIN_SOURCE="$ROOT_DIR/integrations/hermes/beemax-canvas"
PLUGIN_TARGET="${HERMES_HOME:-$HOME/.hermes}/plugins/beemax-canvas"
OPEN_BROWSER=1

if [[ "${1:-}" == "--no-open" ]]; then
  OPEN_BROWSER=0
elif [[ $# -gt 0 ]]; then
  echo "用法: $0 [--no-open]" >&2
  exit 2
fi

NODE_BIN="${BEEMAX_NODE:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "缺少 Node.js 20+；请安装 Node.js 或通过 BEEMAX_NODE 指定路径。" >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "需要 Node.js 20+，当前为 $("$NODE_BIN" --version)。" >&2
  exit 1
fi
if [[ ! -f "$FRONTEND_DIR/index.html" ]]; then
  echo "缺少前端文件：$FRONTEND_DIR/index.html" >&2
  exit 1
fi

HERMES_PYTHON="${HERMES_PYTHON:-}"
for candidate in \
  "$HERMES_PYTHON" \
  "${HERMES_HOME:-$HOME/.hermes}/hermes-agent/venv/bin/python" \
  "${HERMES_HOME:-$HOME/.hermes}/hermes-agent/.venv/bin/python"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    HERMES_PYTHON="$candidate"
    break
  fi
done

if [[ -n "$HERMES_PYTHON" && -x "$HERMES_PYTHON" ]]; then
  mkdir -p "$PLUGIN_TARGET"
  cp -R "$PLUGIN_SOURCE/." "$PLUGIN_TARGET/"
  "$HERMES_PYTHON" -m hermes_cli.main plugins enable beemax-canvas >/dev/null
  if ! PROBE_RESULT="$(printf '%s\n' '{"operation":"probe"}' | "$HERMES_PYTHON" "$PLUGIN_TARGET/hermes_image_provider.py")"; then
    echo "Hermes 已安装，但 image_gen Provider 未配置或未登录：" >&2
    echo "$PROBE_RESULT" >&2
    echo "请先在 Hermes 中配置并登录生图 Provider，再重新执行本命令。" >&2
    exit 1
  fi
  export BEEMAX_CODEX_PROVIDER_COMMAND_JSON
  BEEMAX_CODEX_PROVIDER_COMMAND_JSON="$(
    "$NODE_BIN" -e 'console.log(JSON.stringify(process.argv.slice(1)))' \
      "$HERMES_PYTHON" "$PLUGIN_TARGET/hermes_image_provider.py"
  )"
  export BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON='{"generate":true,"edit":false,"mask":false,"outpaint":false,"variation":false,"references":0}'
  echo "已复用 Hermes 的 image_gen Provider 与 OAuth 登录态。"
else
  echo "未找到 Hermes Python；画布可启动，但生图需要手动配置 Provider。" >&2
fi

export BEEMAX_STANDALONE=1
export BEEMAX_FRONTEND_DIR="$FRONTEND_DIR"
export BEEMAX_PUBLIC_ORIGIN="$APP_URL"
export INUX_DATA_DIR="${INUX_DATA_DIR:-$ROOT_DIR/.data}"

"$NODE_BIN" "$ROOT_DIR/bridge/src/main.mjs" &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 100); do
  if curl --noproxy '*' -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
    echo "Agent Canvas 已启动：$APP_URL"
    echo "按 Ctrl+C 停止服务。"
    if (( OPEN_BROWSER )); then
      if command -v open >/dev/null 2>&1; then open "$APP_URL" >/dev/null 2>&1 || true
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$APP_URL" >/dev/null 2>&1 || true
      fi
    fi
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.1
done

echo "Agent Canvas 启动超时。" >&2
exit 1
