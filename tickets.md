# Tickets: BeeMax Canvas 全引擎生图接入

构建统一的 BeeMax Bridge 生图能力，并通过 Pi 原生 Extension、Hermes 原生 Plugin 和 MCP 接入不同智能体；原中转站保留为可选 Provider 与 fallback。

优先处理所有生图能力。工作时从 **frontier** 选择任务：阻塞项全部完成的任务即可开始。

## BeeMax Bridge 文生图主链与 Provider 路由

**What to build:** 用户在 BeeMax Canvas 发起文生图后，Bridge 创建异步任务，优先调用 Codex 原生生图能力，成功后保存图片并导入当前画布；Codex 不可用、超时或失败时自动切换到原中转站。

**Blocked by:** None — can start immediately.

- [x] Canvas 可以提交提示词、模型、尺寸、比例、质量和批量数量。
- [x] 任务具有 `pending`、`running`、`success`、`error`、`cancelled` 状态，并可查询、取消和重试。
- [x] Provider 通过统一能力声明参与路由，Codex 是默认 primary，原中转站是可配置 fallback。
- [x] Codex 成功时不请求中转站；Codex 失败时自动切换并记录路由过程。
- [x] 图片、缩略图和生成元数据写入项目资产并自动插入当前画布。
- [x] Provider 密钥只保存在服务端，日志和任务结果不得泄露密钥。
- [x] 覆盖 primary 成功、fallback 成功、全部失败、取消和超时测试。

## Codex 全功能图片生成与编辑

**What to build:** 用户能够在 BeeMax Canvas 中使用 Codex 已声明支持的全部图片能力，包括参考图生成、图片编辑、局部重绘、Mask、扩图、多图输入和变体生成，并让结果继续留在可编辑画布工作流中。

**Blocked by:** BeeMax Bridge 文生图主链与 Provider 路由.

- [ ] 统一协议支持 generate、edit、mask、outpaint、variation 和多参考图输入。
- [ ] 输入支持本地文件、画布节点、URL 和 Base64，并统一转为受控资产引用。
- [ ] Provider 能力不足时，在提交前返回可理解的能力错误或选择支持该能力的 fallback。
- [ ] 编辑结果保留源图片、Mask、提示词、模型参数、Provider 和父子关系。
- [ ] 批量结果可以预览、多选、插入画布、再次编辑和重新生成。
- [ ] 覆盖参考图、透明 Mask、比例转换、多图、能力降级和大文件限制测试。

## Pi 原生 Extension 生图闭环

**What to build:** Pi 用户安装 BeeMax Extension 后，可以让 Agent 生成、编辑、取消图片任务并把结果放入 BeeMax Canvas，同时在 Pi 终端看到进度和图片结果。

**Blocked by:** BeeMax Bridge 文生图主链与 Provider 路由; Codex 全功能图片生成与编辑.

- [ ] Extension 以 Pi Package 形式支持 npm、Git 和本地路径安装。
- [ ] 注册生成、编辑、变体、任务查询、任务取消、画布导入和打开画布工具。
- [ ] 工具执行支持增量进度、取消信号、结构化错误和图片内容返回。
- [ ] 任务 ID、资产路径和生成元数据保存在工具结果 details 中，可随会话分支恢复。
- [ ] Pi 插件只调用 BeeMax Bridge，不复制 Provider 路由、凭据或图片处理逻辑。
- [ ] 通过真实 Pi 会话完成“生成图片并放入当前画布”的冒烟测试。

## Hermes 原生 Plugin 生图闭环

**What to build:** Hermes 用户安装 BeeMax Plugin 后，可以复用 Hermes 已配置的 `image_generate` Provider 生成图片，并自动导入 BeeMax Canvas；也可以显式调用 BeeMax Bridge 的 Codex 与 fallback 路由。

**Blocked by:** BeeMax Bridge 文生图主链与 Provider 路由; Codex 全功能图片生成与编辑.

- [ ] 插件使用 Hermes PluginContext 注册画布打开、导入、任务查询和组合生图工具，不修改 Hermes 核心。
- [ ] 默认流程复用 Hermes 当前 `image_generate` 配置，生成文件可直接导入 BeeMax。
- [ ] 提供一次完成“生成并放进画布”的组合工具，并保留生成与导入两个独立步骤。
- [ ] Hermes Provider 不支持请求能力时，可以切换 BeeMax Bridge 的 Codex 或中转站 fallback。
- [ ] 插件安装、启用、禁用和卸载不会破坏 Hermes 原有 Provider 配置。
- [ ] 通过真实 Hermes 会话完成文生图、参考图编辑、失败 fallback 和画布导入测试。

## BeeMax 通用 MCP Server 生图闭环

**What to build:** 任意支持 MCP 的 Agent 连接 BeeMax 后，都能发现生图能力、提交完整图片任务、跟踪状态并将结果导入画布，无需为该 Agent 修改 BeeMax 核心。

**Blocked by:** BeeMax Bridge 文生图主链与 Provider 路由; Codex 全功能图片生成与编辑.

- [ ] MCP 工具覆盖生成、编辑、变体、状态、取消、导入和打开画布。
- [ ] 支持 stdio 与 Streamable HTTP；如需兼容旧客户端，可提供 SSE 兼容模式。
- [ ] 图片输入和输出支持 MCP Resource、本地文件、URL 与 Base64，并实施大小和类型限制。
- [ ] 工具描述包含能力约束，使 Agent 在调用前知道 Mask、参考图数量和取消能力。
- [ ] 同一任务通过 HTTP、Pi、Hermes 和 MCP 查询时得到一致状态与结果。
- [ ] 使用独立 MCP 客户端完成协议与端到端兼容测试。

## HTTP、CLI 与 OpenAI-compatible 接入

**What to build:** 不支持插件或 MCP 的 Agent，也能通过稳定的 HTTP 或 CLI 调用 BeeMax 全部生图能力；现有中转站配置可无损迁移为 OpenAI-compatible Provider。

**Blocked by:** BeeMax Bridge 文生图主链与 Provider 路由; Codex 全功能图片生成与编辑.

- [ ] HTTP API 与 CLI 覆盖生成、编辑、变体、状态、取消和画布导入。
- [ ] CLI 支持机器可读 JSON、退出码、标准输入图片和任务等待模式。
- [ ] OpenAI-compatible Provider 支持独立的地址、模型、超时、重试、并发和密钥配置。
- [ ] 旧中转站配置可以自动迁移，并保持原有文本和视频功能不变。
- [ ] 无扩展 Agent 仅凭命令行或 HTTP 请求即可完成“生成并导入画布”。
- [ ] 覆盖配置迁移、CLI、HTTP、鉴权和中转站回归测试。

## 能力驱动的 BeeMax Canvas 生图界面

**What to build:** 用户可以在画布中看到当前 Agent、Provider 和模型真正支持的图片能力，选择最合适的生成方式，并清楚了解任务进度、fallback 和失败原因。

**Blocked by:** Pi 原生 Extension 生图闭环; Hermes 原生 Plugin 生图闭环; BeeMax 通用 MCP Server 生图闭环; HTTP、CLI 与 OpenAI-compatible 接入.

- [ ] UI 根据能力声明动态展示或禁用参考图、Mask、扩图、变体、批量和取消操作。
- [ ] 用户可以选择 Agent、Provider 和模型，并看到 primary 与 fallback 顺序。
- [ ] 任务面板显示排队、进度、当前 Provider、fallback 事件、取消、重试和历史记录。
- [ ] 生成结果支持对比、多选、插入画布、再次编辑和查看完整来源元数据。
- [ ] Agent 连接断开、Provider 不可用和能力不匹配均提供明确恢复建议。
- [ ] 覆盖桌面浏览器与手机浏览器的关键生图流程测试。

## 全引擎生图兼容性与发布验收

**What to build:** 发布前通过同一套契约和端到端场景证明 Pi、Hermes、MCP、HTTP、CLI、Codex 和中转站可以共同工作，并形成用户可安装、可诊断、可升级的发行包。

**Blocked by:** 能力驱动的 BeeMax Canvas 生图界面.

- [ ] 建立 Provider 与 Agent 能力矩阵，明确“支持、降级、不可用”而非宣称能力同质。
- [ ] Pi、Hermes、MCP、HTTP 和 CLI Adapter 通过统一任务状态与资产结果契约测试。
- [ ] 验证 Codex primary、中转站 fallback、Hermes 原生 Provider 和自定义 OpenAI-compatible Provider。
- [ ] 验证生成、编辑、Mask、扩图、变体、参考图、批量、取消、重试和导入画布。
- [ ] 提供安装、升级、卸载、配置、故障排查和安全说明。
- [ ] macOS 本地 Web 版本完成冷启动、浏览器打开、Agent 连接与完整生图验收。
