#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
PORT="${INUX_TEST_PORT:-17952}"
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

source "$ROOT_DIR/bridge/node-runtime.zsh"
NODE_BIN="$(beemax_resolve_node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  print -u2 "缺少 Node.js，无法运行 BeeMax Bridge 测试"
  exit 1
fi

"$NODE_BIN" --test "$ROOT_DIR/bridge/test/bridge-api.test.mjs"

CODEX_COMMAND_JSON="[\"$NODE_BIN\",\"$ROOT_DIR/bridge/fixtures/fake-codex-provider.mjs\"]"

env \
  INUX_BACKEND_PORT="$PORT" \
  INUX_DATA_DIR="$TEST_DIR/data" \
  INUX_LOG_DIR="$TEST_DIR/logs" \
  INUX_BACKEND_LOG_LEVEL=info \
  BEEMAX_NODE="$NODE_BIN" \
  BEEMAX_CODEX_PROVIDER_COMMAND_JSON="$CODEX_COMMAND_JSON" \
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
curl --noproxy '*' -fsS --max-time 3 "$BASE_URL/api/beemax/health" >"$TEST_DIR/bridge-health.json"
grep -q '"service":"beemax-bridge"' "$TEST_DIR/bridge-health.json"
curl --noproxy '*' -fsS --max-time 3 "$BASE_URL/api/admin/runtime-settings" >"$TEST_DIR/runtime-settings.json"
grep -q '"id":"beemax-codex-agent"' "$TEST_DIR/runtime-settings.json"
grep -q '"name":"BeeMax Hermes + Codex Agent"' "$TEST_DIR/runtime-settings.json"
curl --noproxy '*' -fsS --max-time 3 "$BASE_URL/" >"$TEST_DIR/index.html"
grep -q '<div id="root"></div>' "$TEST_DIR/index.html"
grep -q '<title>BeeMax Canvas</title>' "$TEST_DIR/index.html"

asset_path="$(sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' "$TEST_DIR/index.html")"
[[ -n "$asset_path" ]]
curl --noproxy '*' -fsS --max-time 5 "$BASE_URL$asset_path" >"$TEST_DIR/app.js"
[[ -s "$TEST_DIR/app.js" ]]
grep -q 'AI 配置' "$TEST_DIR/app.js"
grep -Fq '"未命名中转站"===e.name?"未命名 AI 配置"' "$TEST_DIR/app.js"
if grep -Eq '配置中转站|还没有中转站|中转站名称|children:"中转站"' "$TEST_DIR/app.js"; then
  print -u2 "前端仍包含旧的中转站文案"
  exit 1
fi

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

curl --noproxy '*' -fsS --max-time 3 \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"BeeMax Bridge smoke test","model":"gpt-image-2-medium","size":"16:9","async_mode":true,"project_id":"smoke-project","node_id":"smoke-node"}' \
  "$BASE_URL/api/image" >"$TEST_DIR/submitted.json"
task_id="$(sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p' "$TEST_DIR/submitted.json")"
[[ "$task_id" == beemax_image_* ]]

task_ready=0
for _ in {1..100}; do
  curl --noproxy '*' -fsS --max-time 2 "$BASE_URL/api/task/$task_id" >"$TEST_DIR/task.json"
  if grep -q '"status":"completed"' "$TEST_DIR/task.json"; then
    task_ready=1
    break
  fi
  sleep 0.05
done
(( task_ready ))
grep -q '"provider_id":"codex-native"' "$TEST_DIR/task.json"
asset_path="$(sed -n 's/.*"server_urls":\["[^/]*\/\/[^/]*\([^"?]*\)"\].*/\1/p' "$TEST_DIR/task.json")"
[[ "$asset_path" == /uploads/* ]]
curl --noproxy '*' -fsS --max-time 3 "$BASE_URL$asset_path" >"$TEST_DIR/generated.png"
file "$TEST_DIR/generated.png" | grep -q 'PNG image data'
curl --noproxy '*' -fsS --max-time 3 "$BASE_URL/api/assets" >"$TEST_DIR/assets.json"
grep -q "$task_id" "$TEST_DIR/assets.json"

print "PASS Bridge tests, image task, Canvas asset registration and rendered browser UI: $BASE_URL"
