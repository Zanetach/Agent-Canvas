#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
BACKEND="$ROOT_DIR/backend/inux-canvas-backend"
BRIDGE="$ROOT_DIR/bridge/src/main.mjs"
PORT="${INUX_BACKEND_PORT:-17851}"
UPSTREAM_PORT="${BEEMAX_UPSTREAM_PORT:-$((PORT + 1))}"
DATA_DIR="${INUX_DATA_DIR:-$ROOT_DIR/.data}"
LOG_DIR="${INUX_LOG_DIR:-$ROOT_DIR/.logs}"
APP_URL="http://127.0.0.1:$PORT"
UPSTREAM_URL="http://127.0.0.1:$UPSTREAM_PORT"
OPEN_BROWSER=1
FIX_QUARANTINE=0
BACKEND_PID=""
BRIDGE_PID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-open) OPEN_BROWSER=0 ;;
    --fix-quarantine) FIX_QUARANTINE=1 ;;
    *)
      print -u2 "用法: $0 [--no-open] [--fix-quarantine]"
      exit 2
      ;;
  esac
  shift
done

if [[ ! -x "$BACKEND" ]]; then
  print -u2 "找不到可执行后端: $BACKEND"
  exit 1
fi

if [[ ! -f "$BRIDGE" ]]; then
  print -u2 "找不到 BeeMax Bridge: $BRIDGE"
  exit 1
fi

source "$ROOT_DIR/bridge/node-runtime.zsh"
NODE_BIN="$(beemax_resolve_node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  print -u2 "缺少 Node.js。可通过 BEEMAX_NODE 指定 Node 20+ 可执行文件。"
  exit 1
fi

if xattr -p com.apple.quarantine "$BACKEND" >/dev/null 2>&1; then
  if (( FIX_QUARANTINE )); then
    print "正在移除当前提取目录的 macOS 隔离属性: $ROOT_DIR"
    xattr -dr com.apple.quarantine "$ROOT_DIR"
  else
    print -u2 "后端仍被 macOS 隔离，请使用明确的修复选项重试："
    print -u2 "  '$0' --fix-quarantine"
    exit 1
  fi
fi

if curl --noproxy '*' -fsS --max-time 1 "$APP_URL/api/beemax/health" >/dev/null 2>&1; then
  print "BeeMax Canvas 已在运行: $APP_URL"
  (( OPEN_BROWSER )) && open "$APP_URL"
  exit 0
fi

if curl --noproxy '*' -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
  print -u2 "端口 $PORT 已被旧版 Canvas 服务占用。请先停止旧服务，再启动 BeeMax Bridge。"
  exit 1
fi

mkdir -p "$DATA_DIR" "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
BRIDGE_LOG="$LOG_DIR/bridge.log"

cleanup() {
  if [[ -n "$BRIDGE_PID" ]] && kill -0 "$BRIDGE_PID" >/dev/null 2>&1; then
    kill "$BRIDGE_PID" >/dev/null 2>&1 || true
    wait "$BRIDGE_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}

shutdown() {
  cleanup
  trap - EXIT
  exit 0
}

trap shutdown INT TERM
trap cleanup EXIT

env \
  INUX_BACKEND_PORT="$UPSTREAM_PORT" \
  INUX_DATA_DIR="$DATA_DIR" \
  INUX_BACKEND_LOG_LEVEL="${INUX_BACKEND_LOG_LEVEL:-info}" \
  PYTHONUNBUFFERED=1 \
  "$BACKEND" >>"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

upstream_ready=0
for _ in {1..225}; do
  if curl --noproxy '*' -fsS --max-time 0.5 "$UPSTREAM_URL/api/health" >/dev/null 2>&1; then
    upstream_ready=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if (( ! upstream_ready )); then
  print -u2 "原 Canvas 后端启动失败，日志: $BACKEND_LOG"
  tail -n 30 "$BACKEND_LOG" >&2 || true
  exit 1
fi

env \
  INUX_DATA_DIR="$DATA_DIR" \
  BEEMAX_BRIDGE_PORT="$PORT" \
  BEEMAX_UPSTREAM_URL="$UPSTREAM_URL" \
  BEEMAX_PUBLIC_ORIGIN="$APP_URL" \
  BEEMAX_CODEX_PROVIDER_COMMAND_JSON="${BEEMAX_CODEX_PROVIDER_COMMAND_JSON:-}" \
  BEEMAX_CODEX_TIMEOUT_MS="${BEEMAX_CODEX_TIMEOUT_MS:-300000}" \
  BEEMAX_RELAY_BASE_URL="${BEEMAX_RELAY_BASE_URL:-}" \
  BEEMAX_RELAY_API_KEY="${BEEMAX_RELAY_API_KEY:-}" \
  "$NODE_BIN" "$BRIDGE" >>"$BRIDGE_LOG" 2>&1 &
BRIDGE_PID=$!

bridge_ready=0
for _ in {1..150}; do
  if curl --noproxy '*' -fsS --max-time 0.5 "$APP_URL/api/beemax/health" >/dev/null 2>&1; then
    bridge_ready=1
    break
  fi
  if ! kill -0 "$BRIDGE_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if (( ! bridge_ready )); then
  print -u2 "BeeMax Bridge 启动失败，日志: $BRIDGE_LOG"
  tail -n 30 "$BRIDGE_LOG" >&2 || true
  exit 1
fi

print "BeeMax Canvas Web 已启动: $APP_URL"
print "Provider 路由: Codex native -> 中转站 fallback（如已配置）"
print "数据目录: $DATA_DIR"
print "后端日志: $BACKEND_LOG"
print "Bridge 日志: $BRIDGE_LOG"
print "按 Ctrl+C 停止服务。"
(( OPEN_BROWSER )) && open "$APP_URL"

wait "$BRIDGE_PID"
