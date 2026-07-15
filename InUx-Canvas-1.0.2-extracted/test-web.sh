#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
PORT="${INUX_TEST_PORT:-17852}"
BASE_URL="http://127.0.0.1:$PORT"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inux-canvas-web.XXXXXX")"
LAUNCHER_PID=""

cleanup() {
  if [[ -n "$LAUNCHER_PID" ]] && kill -0 "$LAUNCHER_PID" >/dev/null 2>&1; then
    kill "$LAUNCHER_PID" >/dev/null 2>&1 || true
    wait "$LAUNCHER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT INT TERM

env \
  INUX_BACKEND_PORT="$PORT" \
  INUX_DATA_DIR="$TEST_DIR/data" \
  INUX_LOG_DIR="$TEST_DIR/logs" \
  INUX_BACKEND_LOG_LEVEL=info \
  "$ROOT_DIR/start-web.sh" --no-open >"$TEST_DIR/launcher.log" 2>&1 &
LAUNCHER_PID=$!

ready=0
for _ in {1..225}; do
  if curl --noproxy '*' -fsS --max-time 0.5 "$BASE_URL/api/health" >"$TEST_DIR/health.json" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$LAUNCHER_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if (( ! ready )); then
  print -u2 "健康检查失败"
  cat "$TEST_DIR/launcher.log" >&2
  [[ -f "$TEST_DIR/logs/backend.log" ]] && cat "$TEST_DIR/logs/backend.log" >&2
  exit 1
fi

grep -q '"status":"ok"' "$TEST_DIR/health.json"
curl --noproxy '*' -fsS --max-time 3 "$BASE_URL/" >"$TEST_DIR/index.html"
grep -q '<div id="root"></div>' "$TEST_DIR/index.html"

asset_path="$(sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' "$TEST_DIR/index.html")"
[[ -n "$asset_path" ]]
curl --noproxy '*' -fsS --max-time 5 "$BASE_URL$asset_path" >"$TEST_DIR/app.js"
[[ -s "$TEST_DIR/app.js" ]]

headless_shells=(
  "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell(N)
)
if (( ${#headless_shells} == 0 )); then
  print -u2 "缺少用于浏览器烟测的 Playwright Chromium Headless Shell"
  print -u2 "安装命令: npx playwright install chromium"
  exit 1
fi
CHROME="${headless_shells[-1]}"

"$CHROME" \
  --headless \
  --disable-gpu \
  --no-first-run \
  --user-data-dir="$TEST_DIR/chrome-profile" \
  --virtual-time-budget=1500 \
  --dump-dom \
  "$BASE_URL/" >"$TEST_DIR/rendered.html" 2>"$TEST_DIR/chrome.log"

grep -q '新建画布' "$TEST_DIR/rendered.html"
if grep -q '页面运行时出错' "$TEST_DIR/rendered.html"; then
  print -u2 "浏览器渲染进入错误边界"
  exit 1
fi

print "PASS health, assets and rendered browser UI: $BASE_URL"
