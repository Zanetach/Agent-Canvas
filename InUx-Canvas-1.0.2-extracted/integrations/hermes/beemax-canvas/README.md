# BeeMax Canvas for Hermes Agent

这是 BeeMax Canvas 的 Hermes 原生插件。它不修改 Hermes 核心，也不保存或覆盖任何模型密钥。

## 调用策略

- `beemax_generate_and_import` 默认先调用 Hermes 已配置的 `image_generate` Provider，再把结果导入画布。
- Hermes 未配置生图 Provider 或调用失败时，默认回退到 BeeMax Bridge；Bridge 当前按 Codex Provider → 原中转站 Provider 的顺序路由。
- `beemax_generate_image` 可显式直接调用 BeeMax Bridge。
- 当前版本优先完成文生图、图片导入、任务查询/取消/重试和打开 Web 画布；参考图编辑能力需要 Bridge 后续提供统一编辑协议。

## 配置

默认连接 `http://127.0.0.1:17851`。如地址不同：

```bash
export BEEMAX_CANVAS_URL=http://127.0.0.1:17851
```

## 安装

把本目录复制为 `~/.hermes/plugins/beemax-canvas`，然后运行：

```bash
~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main plugins enable beemax-canvas
```

安装完成后重启正在运行的 Hermes 会话，让插件重新发现并注册工具。

## Hermes 中的示例指令

```text
检查 BeeMax Canvas 状态。
用 Hermes 生图引擎生成一张科技蓝蜜蜂 Logo，并导入 BeeMax Canvas。
打开 BeeMax Canvas 网页。
```
