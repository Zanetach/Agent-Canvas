#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
TARGET="${1:-all}"

usage() {
  cat <<'EOF'
用法：./install-agent.sh [codex|hermes|zylos|all]

  codex   复用已配置的 Codex 生图命令 Provider，或检测现有 CLI 登录态
  hermes  安装并启用 BeeMax Canvas Hermes 插件
  zylos   安装 BeeMax Canvas Zylos 组件
  all     自动检测并安装当前环境中已有的 Agent（默认）
EOF
}

info() {
  print -- "[Agent Canvas] $*"
}

warn() {
  print -u2 -- "[Agent Canvas] $*"
}

find_codex() {
  if [[ -n "${CODEX_BIN:-}" && -x "${CODEX_BIN}" ]]; then
    print -- "${CODEX_BIN}"
    return 0
  fi

  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi

  local bundled="/Applications/ChatGPT.app/Contents/Resources/codex"
  if [[ -x "$bundled" ]]; then
    print -- "$bundled"
    return 0
  fi

  return 1
}

find_hermes_python() {
  local hermes_root="${HERMES_HOME:-$HOME/.hermes}"
  local cli_path="${HERMES_CLI:-}"
  if [[ -z "$cli_path" ]] && command -v hermes >/dev/null 2>&1; then
    cli_path="$(command -v hermes)"
  fi

  local cli_python=""
  if [[ -n "$cli_path" && -x "$cli_path" ]]; then
    local shebang
    IFS= read -r shebang <"$cli_path" || true
    if [[ "$shebang" == '#!/usr/bin/env '* ]]; then
      cli_python="$(command -v "${shebang#\#!/usr/bin/env }" 2>/dev/null || true)"
    elif [[ "$shebang" == '#!/'* ]]; then
      cli_python="${shebang#\#!}"
      cli_python="${cli_python%% *}"
    fi
  fi

  local candidate
  for candidate in \
    "${HERMES_PYTHON:-}" \
    "$cli_python" \
    "$hermes_root/hermes-agent/venv/bin/python" \
    "$hermes_root/hermes-agent/.venv/bin/python" \
    "$HOME/hermes-agent/venv/bin/python"; do
    if [[ -n "$candidate" && -x "$candidate" ]] &&
      "$candidate" -c 'import hermes_cli' >/dev/null 2>&1; then
      print -- "$candidate"
      return 0
    fi
  done

  while IFS= read -r candidate; do
    if "$candidate" -c 'import hermes_cli' >/dev/null 2>&1; then
      print -- "$candidate"
      return 0
    fi
  done < <(
    find "$hermes_root" -maxdepth 5 -type f \
      \( -name python -o -name python3 \) -perm -u+x 2>/dev/null
  )

  return 1
}

validate_codex_command_provider() {
  source "$ROOT_DIR/bridge/node-runtime.zsh"
  local node_bin
  if ! node_bin="$(beemax_resolve_node)"; then
    warn "无法校验 Codex 生图命令 Provider：缺少 Node.js 20+。"
    return 1
  fi

  local validation_error
  if ! validation_error="$(
    BEEMAX_PROVIDER_COMMAND_JSON="$BEEMAX_CODEX_PROVIDER_COMMAND_JSON" \
      BEEMAX_PROVIDER_CAPABILITIES_JSON="${BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON:-}" \
      "$node_bin" -e '
        const fs = require("node:fs");
        const path = require("node:path");
        let command;
        try {
          command = JSON.parse(process.env.BEEMAX_PROVIDER_COMMAND_JSON || "");
        } catch {
          process.stderr.write("必须是合法 JSON");
          process.exit(1);
        }
        if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || !part)) {
          process.stderr.write("必须是非空字符串数组");
          process.exit(1);
        }
        const executable = command[0];
        const candidates = executable.includes("/")
          ? [path.resolve(executable)]
          : (process.env.PATH || "").split(path.delimiter).map((directory) => path.join(directory, executable));
        const usable = candidates.some((candidate) => {
          try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
          } catch {
            return false;
          }
        });
        if (!usable) {
          process.stderr.write(`入口不可执行：${executable}`);
          process.exit(1);
        }
        const rawCapabilities = process.env.BEEMAX_PROVIDER_CAPABILITIES_JSON || "";
        if (rawCapabilities) {
          let capabilities;
          try {
            capabilities = JSON.parse(rawCapabilities);
          } catch {
            process.stderr.write("能力声明必须是合法 JSON");
            process.exit(1);
          }
          if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
            process.stderr.write("能力声明必须是 JSON 对象");
            process.exit(1);
          }
        }
      ' 2>&1
  )"; then
    warn "Codex 生图命令 Provider 配置无效：$validation_error"
    return 1
  fi
}

install_codex() {
  if [[ -n "${BEEMAX_CODEX_PROVIDER_COMMAND_JSON:-}" ]]; then
    validate_codex_command_provider || return 1
    info "检测到已配置的 Codex 生图命令 Provider，无需 Codex CLI 登录。"
    return 0
  fi

  local codex_bin
  if ! codex_bin="$(find_codex)"; then
    return 2
  fi

  info "检测到 Codex：$codex_bin"
  if "$codex_bin" login status >/dev/null 2>&1; then
    info "Codex 已登录，可直接使用 Agent Canvas。"
  else
    warn "检测到 Codex CLI，但没有可复用的 CLI 登录态。安装器不会自动启动浏览器登录。"
    warn "无图形服务器请提供 BEEMAX_CODEX_PROVIDER_COMMAND_JSON，或安装 Agent 插件注册本机生图网关。"
    return 3
  fi
}

install_hermes() {
  local hermes_python
  if ! hermes_python="$(find_hermes_python)"; then
    return 2
  fi

  local source_dir="$ROOT_DIR/integrations/hermes/beemax-canvas"
  local target_dir="${HERMES_HOME:-$HOME/.hermes}/plugins/beemax-canvas"

  if [[ ! -d "$source_dir" ]]; then
    warn "找不到 Hermes 插件源目录：$source_dir"
    return 1
  fi

  mkdir -p "$target_dir"
  rsync -a --delete \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude '.pytest_cache/' \
    "$source_dir/" "$target_dir/" || return $?
  "$hermes_python" -m hermes_cli.main plugins enable beemax-canvas || return $?
  info "Hermes 插件已安装并启用：$target_dir"
}

install_zylos() {
  if ! command -v zylos >/dev/null 2>&1; then
    return 2
  fi

  "$ROOT_DIR/integrations/zylos/install-beemax-canvas.sh" || return $?
  info "Zylos 组件安装完成。"
}

run_explicit() {
  local name="$1"
  local installer="$2"

  if "$installer"; then
    return 0
  else
    local exit_code=$?
    if [[ "$exit_code" -eq 2 ]]; then
      warn "当前环境未检测到 $name。请先安装 $name，再重新运行此命令。"
    elif [[ "$exit_code" -eq 3 ]]; then
      warn "当前环境未检测到可直接使用的 $name Provider。"
    else
      warn "$name 安装失败，请查看上方错误信息。"
    fi
    return "$exit_code"
  fi
}

run_all() {
  local installed=0
  local failed=0
  local exit_code

  if install_codex; then
    (( installed += 1 ))
  else
    exit_code=$?
    if [[ "$exit_code" -eq 2 || "$exit_code" -eq 3 ]]; then
      info "未检测到可直接使用的 Codex 生图 Provider，已跳过。"
    else
      warn "Codex 安装失败（退出码 $exit_code），继续处理其他 Agent。"
      (( failed += 1 ))
    fi
  fi

  if install_hermes; then
    (( installed += 1 ))
  else
    exit_code=$?
    if [[ "$exit_code" -eq 2 ]]; then
      info "未检测到 Hermes，已跳过。"
    else
      warn "Hermes 安装失败（退出码 $exit_code），继续处理其他 Agent。"
      (( failed += 1 ))
    fi
  fi

  if install_zylos; then
    (( installed += 1 ))
  else
    exit_code=$?
    if [[ "$exit_code" -eq 2 ]]; then
      info "未检测到 Zylos，已跳过。"
    else
      warn "Zylos 安装失败（退出码 $exit_code），继续处理其他 Agent。"
      (( failed += 1 ))
    fi
  fi

  if [[ "$installed" -eq 0 && "$failed" -eq 0 ]]; then
    if [[ "${AGENT_CANVAS_ALLOW_NO_AGENTS:-0}" == "1" ]]; then
      info "没有检测到本机 Agent；已保留通用网关或手动 Provider 配置。"
      return 0
    fi
    warn "没有检测到可安装的 Agent。"
    return 1
  fi

  info "完成：成功配置 $installed 个 Agent，失败 $failed 个。"
  [[ "$failed" -eq 0 ]]
}

case "$TARGET" in
  codex)
    run_explicit "Codex" install_codex
    ;;
  hermes)
    run_explicit "Hermes" install_hermes
    ;;
  zylos)
    run_explicit "Zylos" install_zylos
    ;;
  all)
    run_all
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    warn "未知目标：$TARGET"
    usage >&2
    exit 64
    ;;
esac
