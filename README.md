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

当前仓库内置的 Canvas 后端为 **macOS Apple Silicon（arm64）** 版本。

- macOS 13 或更高版本
- Apple Silicon：M1、M2、M3、M4 或更新芯片
- Node.js 20 或更高版本
- Git
- 可选：Codex CLI，用于免 API Key 调用 Codex 图片模型
- 可选：Hermes Agent 或 Zylos，用于复用 Agent 已配置的能力

Windows、Linux 和 Intel Mac 暂未提供内置后端二进制文件。

## 快速安装

### 1. 克隆仓库

```bash
git clone https://github.com/Zanetach/Agent-Canvas.git
cd Agent-Canvas/InUx-Canvas-1.0.2-extracted
```

除“更新”章节外，后续命令均假设当前目录为 `InUx-Canvas-1.0.2-extracted`。

### 2. 启动

```bash
./start-web.sh
```

启动完成后会自动打开：

```text
http://127.0.0.1:17851
```

如果不希望自动打开浏览器：

```bash
./start-web.sh --no-open
```

终端按 `Ctrl+C` 可同时停止 Canvas 后端和 BeeMax Bridge。

### 3. macOS 首次运行提示

如果系统提示无法验证下载的程序，只处理当前项目目录的隔离属性：

```bash
./start-web.sh --fix-quarantine
```

该命令不会关闭 macOS Gatekeeper。

## Agent 一键安装

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
| Codex | 检测 Codex CLI，复用已有登录状态；未登录时打开官方登录流程 |
| Hermes | 复制 BeeMax Canvas 插件到 Hermes 插件目录并启用 |
| Zylos | 向 Zylos 注册 BeeMax Canvas 组件 |

安装器可重复运行，用于更新插件或修复安装。完成后启动或重新启动 Agent Canvas：

```bash
./start-web.sh
```

Hermes 默认检测 `~/.hermes/hermes-agent/venv/bin/python`；如果安装在其他位置，请在安装前指定：

```bash
HERMES_PYTHON="/path/to/hermes-agent/venv/bin/python" ./install-agent.sh hermes
```

## Codex 免 Key 接入（手动方式）

Agent Canvas 可以复用本机 Codex CLI 的登录状态，无需在设置页填写 OpenAI API Key。

检查登录状态：

```bash
codex login status
```

如果尚未登录：

```bash
codex login
```

重新启动 Agent Canvas 后，设置页会出现系统托管配置。当前默认图片模型为 `gpt-image-2`。

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

安装后新建 Zylos 会话，使组件描述重新加载。该组件可以直接调用 Agent Canvas；若要让 Canvas 自动使用 Zylos 已配置的模型，Zylos 宿主还需要实现插件协议中的本机 `/v1/*` 网关，并向组件提供模型能力清单。当前并非零配置扫描 Zylos 内部模型。

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

> Codex 图片能力和本机 Hermes 文本能力已有内置适配。其他 Agent 需要由其宿主插件实现协议中的本机 `/v1/*` 网关。

## 手动添加 API

如果当前环境没有可发现的 Agent 模型，可在 Agent Canvas 的“设置 → AI 配置”中手动添加：

- OpenAI 兼容 Base URL
- API Key
- 文本、图片和视频模型名称
- 默认模型

手动填写的 Base URL 和 API Key 会保存在本机数据目录的 `data/runtime-settings.json` 中。它是本地明文配置，请勿提交或共享 `.data` 目录；多用户设备建议限制权限：

```bash
chmod 700 .data .data/data
chmod 600 .data/data/runtime-settings.json
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

```bash
cd Agent-Canvas
git pull --ff-only
cd InUx-Canvas-1.0.2-extracted
./start-web.sh
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
