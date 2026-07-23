#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_URL="${BEEMAX_PUBLIC_ORIGIN:-http://127.0.0.1:${BEEMAX_BRIDGE_PORT:-17851}}"
FRONTEND_DIR="$ROOT_DIR/backend/_internal/frontend/dist"
PLUGIN_SOURCE="$ROOT_DIR/integrations/hermes/beemax-canvas"
HERMES_ROOT="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_TARGET="$HERMES_ROOT/plugins/beemax-canvas"
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

AUTO_PROVIDER_FOUND=0
CODEX_CLI="${CODEX_BIN:-$(command -v codex || true)}"
CODEX_CONFIG_FILE="${BEEMAX_CODEX_CONFIG_FILE:-${CODEX_HOME:-$HOME/.codex}/config.toml}"
if [[ -n "$CODEX_CLI" && -x "$CODEX_CLI" && -f "$CODEX_CONFIG_FILE" ]]; then
  if "$CODEX_CLI" login status >/dev/null 2>&1; then
    export BEEMAX_CODEX_CLI_COMMAND_JSON
    BEEMAX_CODEX_CLI_COMMAND_JSON="$(
      "$NODE_BIN" -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$CODEX_CLI"
    )"
    export BEEMAX_CODEX_CONFIG_FILE="$CODEX_CONFIG_FILE"
    export BEEMAX_CODEX_DIRECT=1
    export BEEMAX_EXPECT_TEXT=1
    AUTO_PROVIDER_FOUND=1
    echo "已识别 Codex CLI 文本模型配置：$CODEX_CONFIG_FILE"
  else
    echo "检测到 Codex CLI，但没有可验证的 CLI 登录态；已跳过 Codex 文本 Provider。" >&2
  fi
fi

REQUESTED_HERMES_PYTHON="${HERMES_PYTHON:-}"
HERMES_CLI_PATH="${HERMES_CLI:-$(command -v hermes || true)}"
HERMES_CLI_PYTHON=""
if [[ -n "$HERMES_CLI_PATH" && -x "$HERMES_CLI_PATH" ]]; then
  IFS= read -r HERMES_CLI_SHEBANG <"$HERMES_CLI_PATH" || true
  case "$HERMES_CLI_SHEBANG" in
    "#!/usr/bin/env "*)
      HERMES_CLI_PYTHON="$(command -v "${HERMES_CLI_SHEBANG#\#!/usr/bin/env }" || true)"
      ;;
    "#!/"*)
      HERMES_CLI_PYTHON="${HERMES_CLI_SHEBANG#\#!}"
      HERMES_CLI_PYTHON="${HERMES_CLI_PYTHON%% *}"
      ;;
  esac
fi

HERMES_PYTHON=""
for candidate in \
  "$REQUESTED_HERMES_PYTHON" \
  "$HERMES_CLI_PYTHON" \
  "$HERMES_ROOT/hermes-agent/venv/bin/python" \
  "$HERMES_ROOT/hermes-agent/.venv/bin/python" \
  "$(command -v python3 || true)" \
  "$(command -v python || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]] &&
    "$candidate" -c 'import hermes_cli' >/dev/null 2>&1; then
    HERMES_PYTHON="$candidate"
    break
  fi
done

if [[ -z "$HERMES_PYTHON" || ! -x "$HERMES_PYTHON" ]]; then
  while IFS= read -r candidate; do
    if "$candidate" -c 'import hermes_cli' >/dev/null 2>&1; then
      HERMES_PYTHON="$candidate"
      break
    fi
  done < <(
    find "$HERMES_ROOT" -maxdepth 5 -type f \
      \( -name python -o -name python3 \) -perm -u+x 2>/dev/null
  )
fi

if [[ -n "$HERMES_PYTHON" && -x "$HERMES_PYTHON" ]]; then
  HERMES_CONFIG_FILE="${BEEMAX_HERMES_CONFIG_FILE:-}"
  if [[ -z "$HERMES_CONFIG_FILE" ]]; then
    HERMES_CONFIG_FILE="$(
      "$HERMES_PYTHON" -m hermes_cli.main config path 2>/dev/null ||
        printf '%s\n' "$HERMES_ROOT/config.yaml"
    )"
  fi
  if [[ ! -f "$HERMES_CONFIG_FILE" ]]; then
    echo "已找到 Hermes，但配置文件不存在：$HERMES_CONFIG_FILE" >&2
    echo "已跳过 Hermes；可通过 BEEMAX_HERMES_CONFIG_FILE 指定实际路径。" >&2
  else
    export BEEMAX_HERMES_COMMAND_JSON
    BEEMAX_HERMES_COMMAND_JSON="$(
      "$NODE_BIN" -e 'console.log(JSON.stringify(process.argv.slice(1)))' \
        "$HERMES_PYTHON" -m hermes_cli.main
    )"
    export BEEMAX_HERMES_CONFIG_FILE="$HERMES_CONFIG_FILE"
    export BEEMAX_EXPECT_TEXT=1
    AUTO_PROVIDER_FOUND=1
    echo "已连接 Hermes 文本模型配置：$HERMES_CONFIG_FILE"

    if ! mkdir -p "$PLUGIN_TARGET" || ! cp -R "$PLUGIN_SOURCE/." "$PLUGIN_TARGET/"; then
      echo "Hermes Canvas 插件安装失败；文本模型仍可用，已跳过 Hermes 生图接入。" >&2
    elif ! "$HERMES_PYTHON" -m hermes_cli.main plugins enable beemax-canvas >/dev/null; then
      echo "Hermes 插件启用失败；文本模型仍可用，已跳过 Hermes 生图接入。" >&2
    elif ! PROBE_RESULT="$(printf '%s\n' '{"operation":"probe"}' | "$HERMES_PYTHON" "$PLUGIN_TARGET/hermes_image_provider.py")"; then
      echo "Hermes image_gen Provider 未配置或未登录，已跳过 Hermes：" >&2
      echo "$PROBE_RESULT" >&2
    else
      export BEEMAX_CODEX_PROVIDER_COMMAND_JSON
      BEEMAX_CODEX_PROVIDER_COMMAND_JSON="$(
        "$NODE_BIN" -e 'console.log(JSON.stringify(process.argv.slice(1)))' \
          "$HERMES_PYTHON" "$PLUGIN_TARGET/hermes_image_provider.py"
      )"
      export BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON='{"generate":true,"edit":false,"mask":false,"outpaint":false,"variation":false,"references":0}'
      IMAGE_PROVIDER_NAME="$(
        printf '%s' "$PROBE_RESULT" | "$NODE_BIN" -e '
          let body = "";
          process.stdin.on("data", (chunk) => { body += chunk; });
          process.stdin.on("end", () => {
            const result = JSON.parse(body);
            process.stdout.write(String(result.provider || "unknown"));
          });
        '
      )"
      echo "已复用 Hermes 的 image_gen Provider 与 OAuth 登录态。"
      echo "已识别生图 Provider：$IMAGE_PROVIDER_NAME"
      echo "已连接 Hermes 模型配置：$HERMES_CONFIG_FILE"
    fi
  fi
else
  echo "未找到可导入 hermes_cli 的 Hermes Python；继续检查其他 Agent Provider。" >&2
fi

if [[ -n "${BEEMAX_AGENT_GATEWAY_URL:-}" || -n "${BEEMAX_AGENT_GATEWAYS_JSON:-}" ]]; then
  export BEEMAX_EXPECT_AGENT_GATEWAY=1
  AUTO_PROVIDER_FOUND=1
  echo "已检测到 Agent 本机网关，将自动读取文本、图片和视频 Manifest。"
fi

if (( AUTO_PROVIDER_FOUND == 0 )); then
  if [[ "${BEEMAX_ALLOW_UNCONFIGURED:-0}" != "1" ]]; then
    echo "没有识别到 Hermes、已登录 Codex 或 Agent 本机网关，已停止部署以避免页面显示“未配置 AI”。" >&2
    echo "可设置 HERMES_HOME、CODEX_BIN 或 BEEMAX_AGENT_GATEWAY_URL；若只想手动配置，可设置 BEEMAX_ALLOW_UNCONFIGURED=1。" >&2
    exit 1
  fi
  echo "未识别到 Agent Provider；已按 BEEMAX_ALLOW_UNCONFIGURED=1 启动手动配置模式。" >&2
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

READINESS_ERROR=""
READINESS_DEADLINE=$((SECONDS + 60))
while (( SECONDS < READINESS_DEADLINE )); do
  if curl --noproxy '*' -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
    if RUNTIME_SETTINGS="$(curl --noproxy '*' -fsS --max-time 2 "$APP_URL/api/admin/runtime-settings" 2>&1)"; then
      if PROVIDER_SUMMARY="$(
        printf '%s' "$RUNTIME_SETTINGS" | "$NODE_BIN" -e '
          let body = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => { body += chunk; });
          process.stdin.on("end", () => {
            let settings;
            try {
              settings = JSON.parse(body);
            } catch {
              console.error("runtime-settings 返回的不是 JSON");
              process.exit(1);
            }
            const providers = Array.isArray(settings.providers) ? settings.providers : [];
            const managed = providers.find((provider) => provider?.id === "beemax-codex-agent");
            if (!managed) {
              console.error("runtime-settings 未返回 BeeMax Agent Provider");
              process.exit(1);
            }
            const imageModels = Array.isArray(managed.imageModels) ? managed.imageModels : [];
            const textModels = Array.isArray(managed.textModels) ? managed.textModels : [];
            const videoModels = Array.isArray(managed.videoModels) ? managed.videoModels : [];
            if (imageModels.length + textModels.length + videoModels.length === 0) {
              console.error("没有识别到可用的文本、图片或视频模型");
              process.exit(1);
            }
            if (process.env.BEEMAX_EXPECT_TEXT === "1" && textModels.length === 0) {
              console.error("检测到 Agent 文本配置，但没有识别到已配置的大语言模型");
              process.exit(1);
            }
            if (
              process.env.BEEMAX_EXPECT_AGENT_GATEWAY === "1" &&
              (!Array.isArray(managed.agentPlugins) || managed.agentPlugins.length === 0)
            ) {
              console.error("检测到 Agent 本机网关，但 Manifest 尚未注册到 Canvas");
              process.exit(1);
            }
            console.log(`已识别 ${textModels.length} 个文本模型、${imageModels.length} 个生图模型、${videoModels.length} 个视频模型`);
          });
        ' 2>&1
      )"; then
        echo "$PROVIDER_SUMMARY"
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
      READINESS_ERROR="$PROVIDER_SUMMARY"
    else
      READINESS_ERROR="无法读取 runtime-settings：$RUNTIME_SETTINGS"
    fi
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.1
done

echo "Agent Canvas 启动校验失败${READINESS_ERROR:+：$READINESS_ERROR}" >&2
exit 1
