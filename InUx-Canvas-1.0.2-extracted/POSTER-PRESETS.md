# BeeMax 商业海报内置模板

BeeMax Canvas 内置三种固定 Style Preset：

- `beemax-poster-emerald-data`：翡翠绿企业数据风
- `beemax-poster-ivory-legal`：象牙白海军蓝法律风
- `beemax-poster-navy-admissions`：深蓝金色招生紧迫风

## Canvas 使用

1. 新建或打开画布，添加图片生成节点。
2. 上传一张主参考图。
3. 在“图片风格”中打开 `BeeMax 商业海报`，选择一个预设。
4. 在提示词中只填写本次 CONTENT；固定风格会由预设自动附加。
5. 比例选择 `3:4`。文字准确性要求高时，让模型生成背景、卡片和图标，再使用 Canvas 文本组件叠加最终中文。

## Agent 结构化调用

Agent 先把结构化 CONTENT 渲染成完整 Prompt：

```http
POST /api/beemax/prompt-presets/render
Content-Type: application/json

{
  "style_id": "beemax-poster-emerald-data",
  "content": {
    "主题": "年度业务数据",
    "品牌名称": "示例集团",
    "主标题": "2026 年度增长报告",
    "副标题": "稳健经营，长期增长",
    "核心数据": "312.9 亿元，同比增长 39%",
    "信息模块一": "规模｜全年新造业务保费",
    "信息模块二": "增长｜核心市场持续增长",
    "信息模块三": "排名｜区域市场第 2 位",
    "CTA": "查看完整报告",
    "合规文字": "数据仅供信息展示，不构成投资建议。"
  }
}
```

响应中的 `prompt` 交给现有 BeeMax 生图工具；同时传入参考图片，并固定 `aspect_ratio` 为响应返回的 `3:4`。缺少任何 CONTENT 字段时接口返回 `422`，避免 Agent 自行编造内容。

所有预设可通过 `GET /api/prompt-styles` 查询。固定风格存储在 Bridge，不由 Agent 在每次请求中重写。
