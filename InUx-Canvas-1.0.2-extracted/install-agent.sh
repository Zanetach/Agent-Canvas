#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"
TARGET="${1:-all}"

usage() {
  cat <<'EOF'
用法：./install-agent.sh [codex|hermes|zylos|all]

  codex   检测 Codex，并复用或完成登录
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
  if [[ -n "${HERMES_PYTHON:-}" && -x "${HERMES_PYTHON}" ]]; then
    print -- "${HERMES_PYTHON}"
    return 0
  fi

  local candidate
  for candidate in \
    "$HOME/.hermes/hermes-agent/venv/bin/python" \
    "$HOME/hermes-agent/venv/bin/python"; do
    if [[ -x "$candidate" ]]; then
      print -- "$candidate"
      return 0
    fi
  done

  return 1
}

install_codex() {
  local codex_bin
  if ! codex_bin="$(find_codex)"; then
    return 2
  fi

  info "检测到 Codex：$codex_bin"
  if "$codex_bin" login status >/dev/null 2>&1; then
    info "Codex 已登录，可直接使用 Agent Canvas。"
  else
    info "Codex 尚未登录，正在打开登录流程……"
    "$codex_bin" login || return $?
    info "Codex 登录完成。"
  fi
}

install_hermes() {
  local hermes_python
  if ! hermes_python="$(find_hermes_python)"; then
    return 2
  fi

  local source_dir="$ROOT_DIR/integrations/hermes/beemax-canvas"
  local target_dir="$HOME/.hermes/plugins/beemax-canvas"

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
    local status=$?
    if [[ "$status" -eq 2 ]]; then
      warn "当前环境未检测到 $name。请先安装 $name，再重新运行此命令。"
    else
      warn "$name 安装失败，请查看上方错误信息。"
    fi
    return "$status"
  fi
}

run_all() {
  local installed=0
  local failed=0
  local status

  if install_codex; then
    (( installed += 1 ))
  else
    status=$?
    if [[ "$status" -eq 2 ]]; then
      info "未检测到 Codex，已跳过。"
    else
      warn "Codex 安装失败（退出码 $status），继续处理其他 Agent。"
      (( failed += 1 ))
    fi
  fi

  if install_hermes; then
    (( installed += 1 ))
  else
    status=$?
    if [[ "$status" -eq 2 ]]; then
      info "未检测到 Hermes，已跳过。"
    else
      warn "Hermes 安装失败（退出码 $status），继续处理其他 Agent。"
      (( failed += 1 ))
    fi
  fi

  if install_zylos; then
    (( installed += 1 ))
  else
    status=$?
    if [[ "$status" -eq 2 ]]; then
      info "未检测到 Zylos，已跳过。"
    else
      warn "Zylos 安装失败（退出码 $status），继续处理其他 Agent。"
      (( failed += 1 ))
    fi
  fi

  if [[ "$installed" -eq 0 && "$failed" -eq 0 ]]; then
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
