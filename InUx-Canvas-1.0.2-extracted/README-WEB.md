# BeeMax Canvas 本地 Web 运行

BeeMax Canvas 是引擎无关的 Agent 创意画布平台，通过 MCP、HTTP 和原生 Adapter 接入不同智能体与生成引擎。

当前版本在原 InUx Canvas macOS ARM64 构建产物前增加 BeeMax Bridge。原后端继续提供画布、文本、视频和静态资源；Bridge 接管图片生成与任务接口，默认路由为：

```text
Codex native → 原中转站 fallback（如已配置）
```

## 启动

```bash
cd /Users/zane/Documents/Agent-01/InUx-Canvas-1.0.2-extracted
./start-web.sh
```

启动成功后自动打开：

```text
http://127.0.0.1:17851
```

终端按 `Ctrl+C` 同时停止 Bridge 和原 Canvas 后端。不希望自动打开浏览器时：

```bash
./start-web.sh --no-open
```

可修改端口和数据目录：

```bash
INUX_BACKEND_PORT=18000 \
INUX_DATA_DIR="$HOME/.beemax-canvas" \
./start-web.sh
```

## Codex 原生生图

Bridge 复用本机 Codex CLI 的 ChatGPT OAuth，不需要在浏览器填写 OpenAI API Key：

```bash
/Applications/ChatGPT.app/Contents/Resources/codex login status
```

如果未登录：

```bash
/Applications/ChatGPT.app/Contents/Resources/codex login
```

Bridge 只读 `~/.codex/auth.json` 当前 access token，不读取或刷新 Codex CLI 的 refresh token，也不依赖 Hermes 安装。

Bridge 会向旧版 Canvas 设置接口注入只读的 `BeeMax Hermes + Codex Agent` 受管 Provider。启动时会从 Hermes 配置发现当前默认 LLM 模型，从 Codex 暴露 `gpt-image-2`，两者会一起出现在“模型配置”中。文本请求交给 Hermes，图片请求交给 Codex；Hermes/Codex 各自保管认证信息，BeeMax 不复制密钥。保存设置时该受管 Provider 会被自动剔除，不会污染原中转站配置。

Hermes 未安装或尚未配置默认模型时，Bridge 仍可启动，但只显示 Codex 图片模型。修改 Hermes 默认模型后重启 BeeMax，即会重新发现并更新文本模型列表。

原画布的 `gpt-image-2` 会根据质量映射为：

- `low` → `gpt-image-2-low`
- `medium` 或未指定 → `gpt-image-2-medium`
- `high` → `gpt-image-2-high`

Bridge 会在图片落盘时校验请求比例；若 Provider 返回比例不一致，会居中裁切到请求比例后再生成缩略图。
画布请求带有 `project_id` 或 `node_id` 时，Bridge 还会把结果登记到原 Canvas 资产库，任务返回 `/uploads/...` URL，供当前生成节点直接写回画布。

## 原中转站 fallback

推荐通过服务端环境变量配置，密钥不会写入任务文件或传给 Codex Provider：

```bash
BEEMAX_RELAY_BASE_URL="https://relay.example/v1" \
BEEMAX_RELAY_API_KEY="your-server-side-key" \
./start-web.sh
```

如果没有设置环境变量，Bridge 会兼容读取原 `runtime-settings.json` 中当前启用 Provider 的 `baseUrl` 和 `apiKey`。环境变量优先级更高。

Codex 成功时不会请求中转站；Codex 认证失败、生成失败或超时后才会调用 fallback。生成结果无论来自哪个 Provider，都会下载到 BeeMax 本地资产目录。

## Bridge API

```text
POST /api/image
GET  /api/task/{task_id}
POST /api/task/{task_id}/cancel
POST /api/task/{task_id}/retry
GET  /api/tasks
GET  /api/beemax/health
GET  /api/beemax/capabilities
```

`POST /api/image` 的 `operation` 支持 `generate`、`edit`、`mask`、`outpaint` 和 `variation`。高级操作使用 `input_images`（最多 10 张）；Mask 额外使用 `mask_image`。图片引用可以是 Canvas 资产路径、HTTP(S) URL 或图片 Data URL，本地文件由 Agent Adapter 先上传为 Canvas 资产。Mask 与源图必须先成为受控资产或 Data URL，且使用同尺寸 PNG，Mask 必须带 alpha 通道。单个及合计受控输入均限制为 50 MB。每个任务会记录源资产、Mask、操作类型、父资产和 Provider 路由。Web 生图面板可直接选择参考图生成、编辑、扩图或变体，局部编辑器会生成带 alpha 通道的 PNG Mask。

`edit`、`mask` 和 `variation` 默认保持源图比例与构图，不再按面板比例二次裁切；需要改变画幅时使用 `outpaint`。`generate` 仍按用户选择的目标比例生成。

为兼容原画布，`status` 保留 `pending`、`running`、`completed`、`failed` 和 `cancelled`；跨引擎字段 `canonical_status` 统一为 `pending`、`running`、`success`、`error` 和 `cancelled`。任务、路由事件和图片元数据会持久化；服务重启后仍可查询。重启时尚未结束的任务会标记为中断失败，可通过 retry 创建新任务。

## Hermes Agent 插件

Hermes 原生插件位于 `integrations/hermes/beemax-canvas`。安装到用户插件目录并启用：

```bash
cp -R integrations/hermes/beemax-canvas "$HOME/.hermes/plugins/beemax-canvas"
~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main plugins enable beemax-canvas
```

新 Hermes 会话会注册画布状态、文生图、参考图生成、整图编辑、Mask、扩图、变体、独立导入、任务查询/取消/重试和打开浏览器等工具。文生图组合工具默认复用 Hermes 当前 `image_generate` Provider；没有配置或调用失败时回退 BeeMax Bridge。高级图片操作走 Bridge 的能力路由。插件不修改 Hermes 核心和原有 Provider 配置。详细工具与环境变量见 `integrations/hermes/beemax-canvas/README.md`。

## 验证

完整验证包括 Bridge 单元/集成测试、原前端资源代理、浏览器渲染和模拟 Codex 生图：

```bash
./test-web.sh
```

测试需要 Node.js 20+；启动脚本会校验版本，并优先选择 PATH 或 Codex 随附的最高兼容版本。浏览器烟测还需要 Playwright Chromium；缺少时安装：

```bash
npx playwright install chromium
```

## macOS 安全提示

若重新从 DMG 提取后出现“Apple 无法验证”提示，只移除当前提取目录的隔离属性：

```bash
./start-web.sh --fix-quarantine
```

该选项只处理当前目录，不关闭系统 Gatekeeper。
