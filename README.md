# 营销内容 Agent 第一版

核心流程：热点采集 -> 楼宇事实包 -> 选题 -> 多渠道文案 -> 海报 -> 发布/导出包。

不依赖飞书或新建 RAG 系统。现有知识库可以直接返回结构化事实包，也可以在首期将每个项目的文本资料传入 `knowledge_documents`。

## 运行

```bash
npm test
npm run demo
```

默认读取 [examples/building-context.json](examples/building-context.json)，并将本次运行的产物写到 `outputs/<run_id>/`。

使用另一份资料运行：

```bash
npm run run -- --input examples/building-context.json
```

## 输入契约

`knowledge_documents` 是首期最简单的知识库接入方式。每份文本建议提供以下字段：

```text
楼宇名称：绿洲中心
城市：上海
商圈：南京西路
地铁：2号线步行3分钟
租金：7.5元/㎡/天
可租面积：200-2000㎡
联系人：张顾问 138-0000-0000
卖点：地铁近、24小时安保、大堂空间适合活动
```

正式接入现有知识库时，直接传入 `knowledge_base`；Agent 只消费检索结果，不负责建库。

## 产物

- `pipeline-report.md`：每个步骤、热点来源、知识资料来源和选择结果。
- `copy.md`：小红书、公众号、朋友圈文案。
- `poster.png`、`poster.svg`、`poster-editable.json`：海报与可编辑图层。
- `wechat-draft.json`：公众号创建草稿前的审核载荷。
- `xiaohongshu-package.md`、`moments-package.txt`：人工发布包。

## HTTP API

```bash
npm start
```

`POST /api/run` 接收与示例 JSON 相同的请求体，并返回本次 run 的结果和可下载产物地址。
