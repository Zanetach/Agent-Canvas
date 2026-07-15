#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
BACKEND="$ROOT_DIR/backend/inux-canvas-backend"
PORT="${INUX_BACKEND_PORT:-17851}"
DATA_DIR="${INUX_DATA_DIR:-$ROOT_DIR/.data}"
LOG_DIR="${INUX_LOG_DIR:-$ROOT_DIR/.logs}"
APP_URL="http://127.0.0.1:$PORT"
OPEN_BROWSER=1
FIX_QUARANTINE=0

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

if curl --noproxy '*' -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
  print "InUx Canvas 已在运行: $APP_URL"
  (( OPEN_BROWSER )) && open "$APP_URL"
  exit 0
fi

mkdir -p "$DATA_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend.log"

env \
  INUX_BACKEND_PORT="$PORT" \
  INUX_DATA_DIR="$DATA_DIR" \
  INUX_BACKEND_LOG_LEVEL="${INUX_BACKEND_LOG_LEVEL:-info}" \
  PYTHONUNBUFFERED=1 \
  "$BACKEND" >>"$LOG_FILE" 2>&1 &
BACKEND_PID=$!

cleanup() {
  if kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
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

ready=0
for _ in {1..225}; do
  if curl --noproxy '*' -fsS --max-time 0.5 "$APP_URL/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if (( ! ready )); then
  print -u2 "InUx Canvas Web 后端启动失败，日志: $LOG_FILE"
  tail -n 30 "$LOG_FILE" >&2 || true
  exit 1
fi

print "InUx Canvas Web 已启动: $APP_URL"
print "数据目录: $DATA_DIR"
print "日志文件: $LOG_FILE"
print "按 Ctrl+C 停止服务。"
(( OPEN_BROWSER )) && open "$APP_URL"

wait "$BACKEND_PID"
