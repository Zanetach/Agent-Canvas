#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_BIN="${AGENT_CANVAS_GIT_BIN:-$(command -v git || true)}"
APP_URL="${BEEMAX_PUBLIC_ORIGIN:-http://127.0.0.1:${BEEMAX_BRIDGE_PORT:-17851}}"
START_MODE="start"
DEPLOY_ARGS=()

usage() {
  cat <<'EOF'
用法：./update.sh [--no-open|--open|--no-start]

  --no-open   更新后启动服务，不打开浏览器
  --open      更新后启动服务并打开浏览器（默认）
  --no-start  只更新代码和 Agent 插件，不启动服务
EOF
}

for argument in "$@"; do
  case "$argument" in
    --no-open) DEPLOY_ARGS=(--no-open) ;;
    --open) DEPLOY_ARGS=() ;;
    --no-start) START_MODE="no-start" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$GIT_BIN" || ! -x "$GIT_BIN" ]]; then
  echo "[Agent Canvas] 缺少 git，无法更新。" >&2
  exit 1
fi

if [[ ! -x "$ROOT_DIR/install-agent.sh" || ! -x "$ROOT_DIR/deploy.sh" ]]; then
  echo "[Agent Canvas] 当前目录缺少安装或部署脚本：$ROOT_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"

changes="$("$GIT_BIN" status --porcelain --untracked-files=normal)"
if [[ -n "$changes" ]]; then
  echo "[Agent Canvas] 检测到未提交修改，已停止更新以避免覆盖本地文件：" >&2
  printf '%s\n' "$changes" >&2
  echo "[Agent Canvas] 请先提交或手动处理这些修改；更新器不会 reset、stash 或删除文件。" >&2
  exit 1
fi

branch="$("$GIT_BIN" branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "[Agent Canvas] 当前处于 detached HEAD，无法安全自动更新。" >&2
  exit 1
fi
if ! "$GIT_BIN" remote get-url origin >/dev/null 2>&1; then
  echo "[Agent Canvas] 未配置 origin 远程仓库，无法自动更新。" >&2
  exit 1
fi

echo "[Agent Canvas] 正在拉取 $branch 最新版本……"
"$GIT_BIN" pull --ff-only origin "$branch"

echo "[Agent Canvas] 正在更新已安装的 Agent 插件……"
AGENT_CANVAS_ALLOW_NO_AGENTS=1 "$ROOT_DIR/install-agent.sh" all

if [[ "$START_MODE" == "no-start" ]]; then
  echo "[Agent Canvas] 更新完成；已按 --no-start 保持服务状态不变。"
  exit 0
fi

if [[ -n "${BEEMAX_UPDATE_RESTART_COMMAND:-}" ]]; then
  echo "[Agent Canvas] 正在通过外部服务管理器重启……"
  /bin/sh -c "$BEEMAX_UPDATE_RESTART_COMMAND"
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if curl --noproxy '*' -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
      echo "[Agent Canvas] 更新并重启完成：$APP_URL"
      exit 0
    fi
    sleep 0.5
  done
  echo "[Agent Canvas] 服务管理器已执行，但健康检查未在 60 秒内通过。" >&2
  exit 1
fi

stop_repo_service() {
  if [[ "${AGENT_CANVAS_SKIP_RUNNING_CHECK:-0}" == "1" ]]; then
    return
  fi

  local port
  port="$(printf '%s' "$APP_URL" | sed -nE 's#^[a-z]+://[^/:]+:([0-9]+).*$#\1#p')"
  local service_reachable=0
  if curl --noproxy '*' -sS -o /dev/null --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
    service_reachable=1
  fi
  local pids=()
  local pid_file="${INUX_DATA_DIR:-$ROOT_DIR/.data}/beemax-bridge.pid"
  if [[ -f "$pid_file" ]]; then
    local stored_pid
    stored_pid="$(tr -cd '0-9' <"$pid_file")"
    if [[ "$stored_pid" =~ ^[0-9]+$ ]] && kill -0 "$stored_pid" 2>/dev/null; then
      pids+=("$stored_pid")
    fi
  fi
  if (( ${#pids[@]} == 0 )) && [[ -n "$port" ]] && command -v lsof >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  fi

  if (( ${#pids[@]} == 0 )); then
    if (( service_reachable == 0 )); then
      return
    fi
    echo "[Agent Canvas] 检测到服务正在运行，但无法确认进程归属；为安全起见未停止。" >&2
    echo "[Agent Canvas] 请先停止旧服务，或设置 BEEMAX_UPDATE_RESTART_COMMAND。" >&2
    exit 1
  fi

  local pid command
  for pid in "${pids[@]}"; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" != *"$ROOT_DIR/bridge/src/main.mjs"* ]]; then
      echo "[Agent Canvas] 端口进程不属于当前仓库，拒绝停止：PID $pid" >&2
      exit 1
    fi
  done
  for pid in "${pids[@]}"; do
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
  done

  local deadline=$((SECONDS + 10))
  while (( SECONDS < deadline )); do
    if ! curl --noproxy '*' -sS -o /dev/null --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done
  echo "[Agent Canvas] 旧服务未在 10 秒内停止，已取消启动新版本。" >&2
  exit 1
}

stop_repo_service
echo "[Agent Canvas] 正在启动更新后的 Agent Canvas……"
exec "$ROOT_DIR/deploy.sh" "${DEPLOY_ARGS[@]}"
