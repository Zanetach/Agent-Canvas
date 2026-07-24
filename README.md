# Agent Canvas

Agent Canvas 是一个面向 AI Agent 的可视化创作画布，支持文本、图片和视频工作流。Codex 图片能力和本机 Hermes 文本能力已有内置适配；Zylos 与其他 Agent 可通过统一插件协议接入。项目也保留手动添加 API 的方式。

当前版本基于 BeeMax Canvas Bridge，提供：

- 文本、图片和视频节点
- 文生图、参考图生成、图片编辑、Mask、扩图和变体
- 商业海报与常用创作模板
- 生成任务查询、取消、重试和重启恢复
- Codex 原生图片生成和 Hermes 文本模型接入
- Agent 插件模型发现与本机网关路由
- OpenAI 兼容 API 和中转服务手动配置

## 系统要求

- Linux x86_64 或 macOS
- Node.js 20 或更高版本
- Git、curl
- 支持：已配置的 Hermes、已登录的 Codex CLI，或实现统一 Manifest 协议的任意本机 Agent 网关

Linux 使用纯 Node.js 独立模式，不会运行仓库中的 macOS Mach-O 后端，也不依赖 macOS 的 `sips`。

## 快速安装

### 1. 克隆仓库

```bash
git clone https://github.com/Zanetach/Agent-Canvas.git
cd Agent-Canvas/InUx-Canvas-1.0.2-extracted
```

除“更新”章节外，后续命令均假设当前目录为 `InUx-Canvas-1.0.2-extracted`。

### 2. 一次部署并启动（推荐）

```bash
./deploy.sh --no-open
```

该命令会一次完成：

- 检测 Node.js 运行环境
- 安装并启用 Hermes Canvas 插件
- 自动连接 Hermes 已配置的 `image_gen` Provider
- 自动读取 Codex CLI 当前文本模型（如果 Codex 已登录）
- 自动读取 Agent 本机网关的文本、图片和视频 Manifest
- 启动独立 Canvas 前端和 Bridge API
- 检查运行时模型确实进入前端配置

启动完成后访问：

```text
http://127.0.0.1:17851
```

桌面环境希望自动打开浏览器时：

```bash
./deploy.sh
```

终端按 `Ctrl+C` 可停止服务。Hermes 安装在非默认位置时：

```bash
HERMES_PYTHON="/path/to/hermes-agent/venv/bin/python" ./deploy.sh --no-open
```

没有 Hermes 时，部署器会继续检测 Codex CLI 与 Agent 本机网关。三者均不可用时会停止，避免页面假成功显示“未配置 AI”。仅需启动后手动配置时，可显式设置 `BEEMAX_ALLOW_UNCONFIGURED=1`。

### 3. macOS 兼容模式

如需继续运行原有 macOS arm64 后端：

```bash
./start-web.sh
```

如果系统提示无法验证下载的程序，可运行 `./start-web.sh --fix-quarantine`。该命令只处理当前项目目录，不会关闭 macOS Gatekeeper。

## Agent 一键安装

### 交给 Agent 自动安装（推荐）

把下面整句话发送给 Codex、Hermes、Zylos 或其他能够执行终端命令的 Agent：

```text
请一次部署并启动 Agent Canvas：如果本机没有项目，请从 https://github.com/Zanetach/Agent-Canvas.git 克隆最新 main；如果目录已存在，请先确认 origin 与该地址一致并检查 git status，仅在工作区干净时执行 git pull --ff-only，否则立即停止并向我报告，禁止 reset、stash、删除或覆盖本地改动；进入 InUx-Canvas-1.0.2-extracted 后执行 ./deploy.sh --no-open，自动复用当前环境中已配置的 Hermes、Codex CLI 或 Agent 本机网关，不要发起新的交互式登录；使用可靠的后台服务方式保持进程运行，轮询 http://127.0.0.1:17851/api/health 和 /api/admin/runtime-settings 最多 60 秒，确认文本、图片、视频模型已进入托管 Provider，最后告诉我服务状态、日志位置和访问地址。
```

Agent 会依次完成下载或安全更新、环境检测、插件安装、服务启动和健康检查。没有终端执行能力的聊天机器人无法使用这种方式，请改用下面的命令安装。

### 使用终端命令安装

进入 `InUx-Canvas-1.0.2-extracted` 后，只需选择当前使用的 Agent：

```bash
./install-agent.sh codex
./install-agent.sh hermes
./install-agent.sh zylos
```

如果同一环境安装了多个 Agent，可以一次自动检测并配置：

```bash
./install-agent.sh all
```

不传参数也等同于 `all`。安装器会跳过当前环境中不存在的 Agent，并逐项显示安装结果：

| Agent | 一键安装执行的操作 |
| --- | --- |
| Codex | 优先复用命令 Provider；否则只检测已有 CLI 登录态，不自动打开浏览器登录 |
| Hermes | 复制 BeeMax Canvas 插件到 Hermes 插件目录并启用 |
| Zylos | 向 Zylos 注册 BeeMax Canvas 组件 |

安装器可重复运行，用于更新插件或修复安装。完成后启动或重新启动 Agent Canvas：

```bash
./deploy.sh --no-open
```

Hermes 默认检测 `~/.hermes/hermes-agent/venv/bin/python`；如果安装在其他位置，请在安装前指定：

```bash
HERMES_PYTHON="/path/to/hermes-agent/venv/bin/python" ./install-agent.sh hermes
```

## Codex 生图 Provider 接入

在 Agent 或无图形服务器中已经配置好 Codex 生图时，不需要运行 `codex login`。推荐把现有能力以命令 Provider 或 Agent 本机网关交给 Bridge。

### 命令 Provider（无浏览器登录）

命令需要实现 Bridge 的 JSON 输入输出协议，不能直接填写普通 `codex` CLI 路径：

```bash
export BEEMAX_CODEX_PROVIDER_COMMAND_JSON='["/path/to/agent-codex-image-provider"]'
export BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON='{"generate":true,"edit":true,"mask":true,"outpaint":true,"variation":true,"references":10}'

./install-agent.sh codex
./start-web.sh --no-open
```

安装器检测到该配置后会直接复用，不会执行 `codex login status` 或启动浏览器。

### Agent 本机网关

如果 Codex 生图由 Agent 管理，Agent 插件应按[插件协议](InUx-Canvas-1.0.2-extracted/integrations/AGENT-PLUGIN-PROTOCOL.md)提供本机 `/v1/manifest` 与 `/v1/*` 网关，并在启动环境中声明网关地址：

```bash
export BEEMAX_AGENT_GATEWAY_URL='http://127.0.0.1:19000'
```

Canvas 会从 `/v1/manifest` 自动读取文本、图片和视频模型。旧宿主仍可通过 `BEEMAX_AGENT_MODELS_JSON` 直接上报能力清单。API Key 和认证信息继续由 Agent 管理，不进入 Canvas。

### Codex CLI 登录态（可选）

Agent Canvas 可以复用本机 Codex CLI 的登录状态，无需在设置页填写 OpenAI API Key。

检查登录状态：

```bash
codex login status
```

如果尚未登录：

```bash
codex login
```

该命令必须由用户主动执行。`install-agent.sh` 不会自动发起交互式登录，因此可以安全用于无图形服务器。

重新启动 Agent Canvas 后，设置页会出现 Codex 当前 `config.toml` 文本模型和默认图片模型 `gpt-image-2`。

如果 `codex` 不在 `PATH`，可以使用 ChatGPT 应用内置的命令：

```bash
/Applications/ChatGPT.app/Contents/Resources/codex login
```

## Hermes Agent 安装（手动方式）

Hermes 插件位于 `integrations/hermes/beemax-canvas`。

```bash
mkdir -p "$HOME/.hermes/plugins/beemax-canvas"
rsync -a --delete \
  integrations/hermes/beemax-canvas/ \
  "$HOME/.hermes/plugins/beemax-canvas/"
~/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main plugins enable beemax-canvas
```

如果 Hermes 安装在其他目录，请把上述 Python 路径替换为实际的 Hermes 虚拟环境路径。安装后重新打开 Hermes 会话。插件提供画布状态检查、图片生成、参考图、编辑、Mask、扩图、变体、资产导入以及任务控制工具。

详细说明见 [Hermes 插件文档](InUx-Canvas-1.0.2-extracted/integrations/hermes/beemax-canvas/README.md)。

## Zylos 安装（手动方式）

```bash
./integrations/zylos/install-beemax-canvas.sh
```

安装后新建 Zylos 会话，使组件描述重新加载。Zylos 宿主只需实现插件协议中的本机 `/v1/manifest` 与 `/v1/*` 网关，并提供 `BEEMAX_AGENT_GATEWAY_URL`；组件会自动发现全部文本、图片和视频模型，不再需要复制模型清单。

详细说明见 [Zylos 组件文档](InUx-Canvas-1.0.2-extracted/integrations/zylos/beemax-canvas/README.md)。

## Agent 插件模型接入

Agent 插件可向 Canvas 注册自身已有的文本、图片和视频模型。API Key 始终由 Agent 管理，不会写入 Canvas。

统一协议包括：

- 模型与能力注册
- 文本生成
- 图片生成与编辑
- 视频生成与任务查询
- 健康检查和任务取消

完整协议见 [Agent 插件协议](InUx-Canvas-1.0.2-extracted/integrations/AGENT-PLUGIN-PROTOCOL.md)。

> Codex 文本与图片能力、Hermes 模型扫描已有内置适配。其他 Agent 只需实现本机 `/v1/manifest` 与对应的 `/v1/*` 执行网关。

## 手动添加 API

兼容 macOS 原后端时，可在 Agent Canvas 的“设置 → AI 配置”中手动添加：

- OpenAI 兼容 Base URL
- API Key
- 文本、图片和视频模型名称
- 默认模型

独立模式会把设置页内容保存在 `beemax-bridge/runtime-settings.json`，但为避免在运行时静默切换服务端密钥，当前生成路由只使用启动时发现的 Agent Provider 或下面的服务端环境变量。配置文件是本地明文，请勿提交或共享 `.data` 目录；多用户设备建议限制权限：

```bash
chmod 700 .data .data/beemax-bridge
chmod 600 .data/beemax-bridge/runtime-settings.json
```

也可以通过服务端环境变量配置图片 fallback：

```bash
BEEMAX_RELAY_BASE_URL="https://relay.example/v1" \
BEEMAX_RELAY_API_KEY="your-server-side-key" \
./start-web.sh
```

服务端密钥不会传给 Codex Provider，也不会写入生成任务文件。

## 自定义端口和数据目录

```bash
INUX_BACKEND_PORT=18000 \
INUX_DATA_DIR="$HOME/.agent-canvas" \
./start-web.sh
```

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `INUX_BACKEND_PORT` | `17851` | Web 与 Bridge 端口 |
| `INUX_DATA_DIR` | 项目内 `.data` | 项目、任务和资产数据目录 |
| `INUX_LOG_DIR` | 项目内 `.logs` | 后端与 Bridge 日志目录 |
| `BEEMAX_RELAY_BASE_URL` | 空 | 图片 fallback 服务地址 |
| `BEEMAX_RELAY_API_KEY` | 空 | fallback 服务端密钥 |
| `BEEMAX_CODEX_PROVIDER_COMMAND_JSON` | 空 | Agent 已配置的 Codex 生图命令 Provider |
| `BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON` | 空 | 命令 Provider 的图片能力声明 |
| `BEEMAX_CODEX_TIMEOUT_MS` | `300000` | Codex 生成超时 |

## 测试

```bash
./test-install-agent.sh
./test-web.sh
```

`test-install-agent.sh` 覆盖 Codex、Hermes、Zylos 和自动检测安装流程；`test-web.sh` 覆盖 Bridge API、Codex Provider、图片任务和浏览器界面：

```bash
npx playwright install chromium
```

Hermes 与 Zylos 集成测试分别运行：

```bash
python3 integrations/hermes/beemax-canvas/test_plugin.py
npm test --prefix integrations/zylos/beemax-canvas
```

## 更新

已经安装过的环境，进入项目目录后执行：

```bash
cd Agent-Canvas
./update.sh --no-open
```

更新器会依次检查本地修改、执行 `git pull --ff-only`、更新 Codex/Hermes/Zylos
集成，并安全重启属于当前仓库的 Canvas 服务。检测到未提交修改、未知端口进程或
任一更新步骤失败时会停止，不会执行 `reset`、`stash` 或删除本地文件。

仅更新、不重启：

```bash
./update.sh --no-start
```

如果服务由 systemd、Docker 或其他进程管理器托管，可把重启命令交给更新器：

```bash
BEEMAX_UPDATE_RESTART_COMMAND='systemctl --user restart agent-canvas' ./update.sh --no-open
```

旧版本第一次升级到包含更新器的版本时，先执行一次：

```bash
cd Agent-Canvas && git pull --ff-only && ./update.sh --no-open
```

## Release

### v1.0.3

- 增加统一的 Agent 一键安装器
- 支持 Codex、Hermes、Zylos 单独安装
- 支持 `all` 自动检测并配置当前环境中的多个 Agent
- 增加安装器的隔离测试，验证登录、复制、启用和注册流程

### v1.0.2

- 发布 Agent Canvas 本地 Web 版本
- 提供 Codex 原生图片生成与 Hermes 文本模型托管
- 支持文本、图片、视频 Agent 插件协议
- 支持商业海报、模板库和统一右侧生成面板
- 增加任务持久化、取消、重试和稳定性优化
- 增加 Hermes 与 Zylos 集成包

完整版本记录请查看 [GitHub Releases](https://github.com/Zanetach/Agent-Canvas/releases)。
