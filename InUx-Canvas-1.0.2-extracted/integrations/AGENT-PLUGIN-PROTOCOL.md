# BeeMax Agent 插件协议

BeeMax Canvas 通过一个很小的本机协议接入 Agent 已配置的模型。插件只公布模型名称与 Agent 本机网关，不复制 API Key。

## 自动发现（推荐）

Agent 本机网关提供：

```http
GET http://127.0.0.1:19000/v1/manifest
```

```json
{
  "id": "my-agent",
  "agent": "My Agent",
  "models": {
    "text": ["my-llm"],
    "image": ["my-image-model"],
    "video": ["my-video-model"]
  },
  "capabilities": {
    "image": {
      "generate": true,
      "references": 0
    }
  }
}
```

启动 Canvas 时只需提供本机网关：

```bash
export BEEMAX_AGENT_GATEWAY_URL='http://127.0.0.1:19000'
./deploy.sh --no-open
```

多个网关使用：

```bash
export BEEMAX_AGENT_GATEWAYS_JSON='["http://127.0.0.1:19000","http://127.0.0.1:19001"]'
```

Canvas 会调用本机发现接口读取 Manifest、校验模型类型并完成注册。Manifest 中即使意外包含 Key，Canvas 也只保留协议定义的非敏感字段。

## 注册

Agent 插件启动时向 Canvas 发送：

```http
POST http://127.0.0.1:17851/api/beemax/agent-plugins/register
Content-Type: application/json
```

```json
{
  "id": "my-agent",
  "agent": "My Agent",
  "endpoint": "http://127.0.0.1:19000",
  "models": {
    "text": ["my-llm"],
    "image": ["my-image-model"],
    "video": ["my-video-model"]
  },
  "capabilities": {
    "image": {
      "generate": true,
      "edit": false,
      "mask": false,
      "outpaint": false,
      "variation": false,
      "references": 0
    }
  }
}
```

约束：

- `endpoint` 必须是回环地址上的 HTTP 服务，防止把 Canvas 变成任意远程代理。
- 只接受 `text`、`image`、`video` 三类模型。
- 图片高级能力必须由插件明确声明；默认仅启用文生图，避免把不支持 Mask/扩图的模型错误展示为可用。
- 不接受也不保存 Agent 的 API Key；凭证始终由 Agent 管理。
- 非敏感能力清单保存在 Bridge 数据目录的 `agent-plugins.json`，Canvas 重启后会自动恢复。
- 重复注册同一个 `id` 会原位更新能力清单，适合插件启动或模型配置变化后重新同步。
- Bridge 重启时会调用 `GET /v1/health` 探活；离线插件不会进入可选模型列表。

## 查询

```http
GET http://127.0.0.1:17851/api/beemax/agent-plugins
```

设置页会把插件模型与 Codex/Hermes 内置能力合并到系统托管 Provider。没有自动发现的能力仍可通过“手动添加 API”配置。

## 本机网关调用

Bridge 根据“插件 ID + 模型类型 + 模型名”把请求发回注册它的 Agent：

- `POST /v1/text`：返回 `{ "success": true, "text": "..." }`。
- `POST /v1/image`：返回 `{ "success": true, "data_url": "data:image/png;base64,..." }`。
- `POST /v1/video`：返回 `{ "success": true, "task_id": "..." }`。
- `POST /v1/task`：输入 `task_id`，返回 Agent 任务状态与 `server_urls`。
- `POST /v1/cancel`：取消 Agent 任务。
- `GET /v1/health`：用于 Canvas 重启后的可用性确认。
- `GET /v1/manifest`：返回非敏感的模型与能力清单，用于零复制自动发现。

模型名称在同一类型内必须唯一；如果两个 Agent 注册同名模型，后注册者会收到冲突错误，避免请求被路由到错误的 Agent。

## Agent 适配

- Codex：Bridge 内置文本与图片适配，复用 Codex 登录状态，不要求额外 Key。
- Hermes：`integrations/hermes/beemax-canvas` 提供 `register_agent_capabilities`。
- Zylos：`integrations/zylos/beemax-canvas` 提供 `registerAgentCapabilities`。
- 其他 Agent：优先实现 `/v1/manifest`；也可直接发送注册请求，无需修改 Canvas 核心。

Hermes 与 Zylos 适配器会在插件生命周期读取 `BEEMAX_AGENT_GATEWAY_URL` 并自动发现模型。`BEEMAX_AGENT_MODELS_JSON` 与 `BEEMAX_AGENT_INSTANCE_ID` 仅用于兼容无法提供 Manifest 的旧宿主。它们都不是模型 API 地址或 Key。
