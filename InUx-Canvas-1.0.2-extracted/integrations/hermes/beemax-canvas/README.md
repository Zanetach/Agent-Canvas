# BeeMax Canvas for Hermes Agent

这是 BeeMax Canvas 的 Hermes 原生插件。它不修改 Hermes 核心，也不保存或覆盖任何模型密钥。

## 调用策略

- `beemax_generate_and_import` 默认先调用 Hermes 已配置的 `image_generate` Provider，再把结果导入画布。
- Hermes 未配置生图 Provider 或调用失败时，默认回退到 BeeMax Bridge；Bridge 当前按 Codex Provider → 原中转站 Provider 的顺序路由。
- `beemax_generate_image` 可显式直接调用 BeeMax Bridge。
- 高级图片操作（参考图生成、整图编辑、Mask、扩图、变体）直接调用 BeeMax Bridge 的能力路由，因为 Hermes 内置 `image_generate` 当前只提供文生图参数。

## 图片能力

| Hermes 工具 | 能力 |
| --- | --- |
| `beemax_generate_image` | 文生图 |
| `beemax_generate_from_references` | 1–10 张高保真参考图生成 |
| `beemax_edit_image` | 整图编辑 |
| `beemax_mask_edit` | Alpha PNG Mask 局部重绘 |
| `beemax_outpaint_image` | 按目标比例/1K–4K 扩图 |
| `beemax_create_variation` | 高保真参考图变体 |

本地文件会先导入 Canvas 资产库，再提交给 Bridge。也可直接传 Canvas 资产路径、HTTP(S) URL 或图片 Data URL。所有高级操作完成后都会把结果导入 Canvas。

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
参考这两张产品图生成一张科技蓝广告图，并导入 BeeMax Canvas。
把这张图片中 Mask 的透明区域改成蓝色电路纹理。
把这张方图扩成 16:9 的 4K 横图。
打开 BeeMax Canvas 网页。
```
