# 营销内容 Agent 实施手册

## 1. 目的和边界

用 Hermes Agent 编排 5 个现成的开源 Skill，完成一轮楼宇营销内容生产：

1. 采集社交热点、城市新闻和政府政策信号。
2. 读取用户在对话中提供的项目资料。
3. 产出可选营销选题，由用户确认。
4. 生成公众号正文、小红书图文文案、朋友圈转发文案和海报。
5. 将公众号内容保存为草稿；小红书和朋友圈先导出，人工发布。

第一版不建设独立工作台，不建设新的知识库，不把城市或楼宇信息写死在 Skill 内。用户在对话中提供飞书链接、云盘链接、文件、网页链接或直接粘贴资料；Hermes 用已接入的 MCP 或读取工具获取内容。

## 2. 安装清单

基础内容生产链安装以下 5 个 Skill。完整营销 Agent 还需按 2.1 的能力图谱追加洞察、策略、转化和优化 Skill；Hermes 应按任务编排调用，而不是每次调用全部 Skill。

| 能力 | Skill | 上游链接 | 安装目录 |
| --- | --- | --- | --- |
| 热点和新闻采集 | `news-aggregator-skill` | https://github.com/cclank/news-aggregator-skill | `news-aggregator-skill/` |
| 热点到营销选题 | `content-strategy` | https://github.com/coreyhaines31/marketingskills/tree/main/skills/content-strategy | `content-strategy/` |
| 多渠道营销文案 | `copywriting` | https://github.com/coreyhaines31/marketingskills/tree/main/skills/copywriting | `copywriting/` |
| 海报主视觉 | `baoyu-cover-image` | https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-cover-image | `baoyu-cover-image/` |
| 公众号草稿发布 | `baoyu-post-to-wechat` | https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-post-to-wechat | `baoyu-post-to-wechat/` |

可选安装：`baoyu-xhs-images`，用于将已确认的小红书文案拆为多张信息卡。链接：
https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-xhs-images

### 2.1 完整营销能力图谱

| 营销模块 | Skill | 是否属于内容生产基础链 |
| --- | --- | --- |
| 项目定位、价值主张、品牌上下文 | `product-marketing` | 否，策略基础 |
| 用户画像、需求、决策链、客户语言 | `customer-research` | 否，策略基础 |
| 竞品和市场信息 | `competitor-profiling` | 否，策略基础 |
| 营销目标、渠道、节奏和指标 | `marketing-plan` | 否，策略基础 |
| 热点、城市新闻、政府政策信号 | `news-aggregator-skill` | 是 |
| 选题与内容规划 | `content-strategy` | 是 |
| 公众号等营销文案 | `copywriting` | 是 |
| 小红书等社媒内容策略 | `social` | 否，渠道扩展 |
| 主视觉和封面 | `baoyu-cover-image` | 是 |
| 小红书图文卡片 | `baoyu-xhs-images` | 否，渠道扩展 |
| 公众号草稿发布 | `baoyu-post-to-wechat` | 是 |
| 预约页/表单转化 | `cro` | 否，增长转化 |
| 线索分级与销售协同 | `revops` | 否，增长转化 |
| 内容、咨询、预约、到访指标 | `analytics` | 否，增长优化 |
| 标题、卖点、CTA、视觉实验 | `ab-testing` | 否，增长优化 |

政府政策不是一个独立营销 Skill。它是 `news-aggregator-skill` 的官方来源配置，必须输出发文机关、日期和原文链接。

## 3. 在目标 Agent 平台安装

### 3.1 Hermes：精确安装命令

以下命令只安装本方案需要的 5 个 Skill。首次安装前，确认目标目录中不存在同名目录；若已存在，先检查其来源和版本，不能直接覆盖。

```bash
mkdir -p ~/.hermes/skills/marketing
mkdir -p /tmp/marketing-agent-skills

git clone --depth 1 https://github.com/cclank/news-aggregator-skill.git \
  ~/.hermes/skills/marketing/news-aggregator-skill

git clone --depth 1 https://github.com/coreyhaines31/marketingskills.git \
  /tmp/marketing-agent-skills/marketingskills

cp -R /tmp/marketing-agent-skills/marketingskills/skills/content-strategy \
  ~/.hermes/skills/marketing/

cp -R /tmp/marketing-agent-skills/marketingskills/skills/copywriting \
  ~/.hermes/skills/marketing/

git clone --depth 1 https://github.com/JimLiu/baoyu-skills.git \
  /tmp/marketing-agent-skills/baoyu-skills

cp -R /tmp/marketing-agent-skills/baoyu-skills/skills/baoyu-cover-image \
  ~/.hermes/skills/marketing/

cp -R /tmp/marketing-agent-skills/baoyu-skills/skills/baoyu-post-to-wechat \
  ~/.hermes/skills/marketing/
```

安装完成后验证：

```bash
find "$HOME/.hermes/skills/marketing" -maxdepth 2 -name SKILL.md -print
```

预期输出恰好包含：`news-aggregator-skill`、`content-strategy`、`copywriting`、`baoyu-cover-image`、`baoyu-post-to-wechat` 五个目录。

### 3.2 Hermes：追加完整营销能力

在已经完成 3.1 的基础上，执行以下命令添加策略、用户洞察、渠道、转化和优化能力。命令只复制所需目录，不安装整个仓库到 Hermes Skill 目录。

```bash
set -e

SKILL_ROOT="$HOME/.hermes/skills/marketing"
WORK_DIR="/tmp/marketing-agent-skills"

# 若 3.1 已执行，此目录已存在；否则先克隆来源仓库。
if [ ! -d "$WORK_DIR/marketingskills/.git" ]; then
  git clone --depth 1 https://github.com/coreyhaines31/marketingskills.git \
    "$WORK_DIR/marketingskills"
fi

# 策略、洞察、转化、分析 Skill
for skill in \
  product-marketing \
  customer-research \
  competitor-profiling \
  marketing-plan \
  social \
  cro \
  revops \
  analytics \
  ab-testing
do
  if [ -e "$SKILL_ROOT/$skill" ]; then
    echo "Skip existing skill: $skill"
  else
    cp -R "$WORK_DIR/marketingskills/skills/$skill" "$SKILL_ROOT/"
  fi
done

# 小红书图文卡片 Skill
if [ ! -d "$WORK_DIR/baoyu-skills/.git" ]; then
  git clone --depth 1 https://github.com/JimLiu/baoyu-skills.git \
    "$WORK_DIR/baoyu-skills"
fi

if [ ! -e "$SKILL_ROOT/baoyu-xhs-images" ]; then
  cp -R "$WORK_DIR/baoyu-skills/skills/baoyu-xhs-images" "$SKILL_ROOT/"
fi
```

完整安装后，Hermes 将有 15 个营销相关 Skill。日常“生成一篇招商内容”通常只调用 4 到 7 个；“制定月度营销计划”才会调用用户洞察、竞品、营销规划、内容策略和指标等上游能力。

### 3.3 其他支持 Agent Skills 的平台

分别下载或克隆上表中的仓库，只保留这 5 个完整目录。每个目录必须包含 `SKILL.md` 以及其下的 `scripts/`、`references/`、`assets/` 等文件，不能只复制 `SKILL.md`。

目标目录取决于平台：

```text
<平台的 Skill 根目录>/
  news-aggregator-skill/
  content-strategy/
  copywriting/
  baoyu-cover-image/
  baoyu-post-to-wechat/
```

常见目录约定：

```text
Claude Code:  <项目>/.claude/skills/
通用 Agent:  <项目>/.agents/skills/
Hermes:       ~/.hermes/skills/marketing/
```

如果平台有“安装 GitHub Skill”界面，逐个填入上表的上游链接即可；如果它只支持压缩包导入，压缩每一个完整 Skill 目录后上传。

### 3.4 必要运行环境

| Skill | 前置条件 | 验证方式 |
| --- | --- | --- |
| `news-aggregator-skill` | Python 3.10+、`requests`、`beautifulsoup4`；深度正文抓取另需 Playwright 浏览器 | `python scripts/fetch_news.py --help` |
| `baoyu-cover-image` | 目标 Agent 已配置图像模型，或自身具备生图能力 | 让 Agent 生成一张无文字测试封面 |
| `baoyu-post-to-wechat` | Bun 或 npx、Chrome；公众号 API 凭据或 Chrome 已登录的公众号后台 | 先创建一篇测试草稿，不群发 |

热点 Skill 的依赖安装：

```bash
cd <Skill根目录>/news-aggregator-skill
pip install -r requirements.txt
playwright install chromium
```

公众号凭据只放在平台要求的私密环境变量或 `.env` 中，不能提交到 Git 仓库。

## 4. 首次配置

### 4.1 为 Agent 接入资料读取能力

这不是新的营销 Skill。确认 Hermes 已能读取以下至少一种来源：

- 飞书文档或飞书云盘（通过飞书 MCP）。
- 企业已有知识库（通过现有 MCP）。
- 本地文件上传。
- 用户粘贴的文字或网页链接。

首次测试准备一份项目资料，至少包含：城市、楼宇名称、地址或商圈、可出租面积、目标客户、核心卖点、真实配套、可公开的联系方式、禁用表述和品牌视觉参考。

### 4.2 配置热点与政策来源

城市是每次任务的输入，例如“上海”，不是写入 Skill 的固定配置。

热点采集分为两类，结果必须分开展示：

| 类型 | 用途 | 最低输出字段 |
| --- | --- | --- |
| 社交/新闻热点 | 找话题和传播角度 | 标题、热度/来源、发布时间、原始链接 |
| 政府政策/官方新闻 | 提供事实依据和行业背景 | 发文机关、发布日期、原文链接、适用城市、政策摘要 |

在 `news-aggregator-skill` 的自定义 OPML 来源中加入目标城市的政府网站 RSS；没有 RSS 的网站，先使用其公开新闻页或由 Agent 的网页读取能力抓取。第一版建议每个城市至少配置：市政府门户、住建局、规划和自然资源部门、发改委或商务部门。

官方政策不能直接包装成“热点”。Agent 必须标明来源、日期和原文链接，并在生成营销表达前让用户确认。

### 4.3 配置公众号

先选择一种方式：

1. **API 方式**：在公众号后台创建并保存 AppID、AppSecret；适合稳定自动化。
2. **Chrome 方式**：在专用 Chrome Profile 登录公众号后台；适合 PoC。

第一版只允许“创建草稿”，不允许自动群发。发布动作必须由公众号运营人员在后台最终确认。

## 5. 单次执行 SOP

### 步骤 1：在对话中提交任务

将项目资料链接或文件与任务一起发给 Hermes。可直接使用以下指令：

```text
为上海的「[楼宇名称]」做今天的营销内容。

项目资料：[飞书文档/云盘/网页/附件链接]
目标客户：[例如科技、专业服务、金融企业]
本次目标：[招商获客 / 品牌曝光 / 到访预约]
渠道：[公众号、小红书、朋友圈]
请执行：
1. 采集近 24 小时上海相关的社交热点、城市新闻、楼宇/产业信息和官方政策；
2. 将社交热点与官方政策分组，保留每条原始链接、来源和日期；
3. 结合项目资料，给出 3 个营销选题；
4. 暂时不要写正文、不要生成图片、不要发布，等待我选题。
```

### 步骤 2：人工选择选题

Agent 必须一次返回 3 个候选选题。每个选题固定包含：

- 选题标题。
- 关联的热点或政策证据链接。
- 与该楼宇真实卖点的连接逻辑。
- 推荐渠道。
- 风险提示：时效、事实、政策合规或敏感表达。

运营人员只回复：

```text
选择选题 2。重点突出 [指定卖点]，不要使用 [禁用词]。
```

### 步骤 3：生成图文初稿

```text
按选题 2 生成待审核内容：
1. 公众号：标题 3 个、摘要、正文、文末行动引导；
2. 小红书：标题 3 个、正文、标签建议；
3. 朋友圈：一条不超过 80 字的转发文案；
4. 引用的政策或新闻必须保留原始链接，不得补写未提供的楼宇事实；
5. 暂不发布。
```

审核要点：项目参数、地址、面积、价格、交通、政策表述、联系方式必须来自项目资料或可验证原文；无法确认的事实直接删除。

### 步骤 4：生成海报

内容审核通过后发送：

```text
基于已确认文案生成一张楼宇营销海报。
尺寸：1080 x 1440，适合朋友圈和小红书。
主体：楼宇或真实场景，不能使用与项目无关的建筑。
信息层级：主标题、一个真实卖点、预约行动引导。
风格：克制、现代、商务；不生成密集小字。
先出 2 个视觉方案供我选择，不要加入未经确认的数据或联系方式。
```

选定方案后，导出 PNG。海报上的中文长文案应由可编辑排版层完成；纯生图模型不适合稳定生成大量中文文字。

### 步骤 5：交付与发布

```text
将已确认的公众号内容创建为公众号草稿，标题使用方案 B，封面使用已确认海报。
不要群发。完成后返回草稿标题和后台状态。
同时导出小红书图文素材和朋友圈海报 PNG。
```

交付物应包括：

1. 公众号草稿状态或草稿链接。
2. 小红书标题、正文、封面/图文素材。
3. 朋友圈海报 PNG 与短文案。
4. 本轮热点和政策的来源清单。

小红书与朋友圈在 P0 阶段由人工上传发布。小红书自动发布依赖浏览器登录态且有账号风控，不纳入第一版自动化。

## 6. 一轮验收标准

用一个真实或脱敏楼宇项目完成以下闭环即为通过：

- Agent 能读到一份飞书或附件资料。
- 能返回至少 5 条带链接的社交/新闻信号和至少 2 条带发文机关、日期、链接的官方信息。
- 能根据资料给出 3 个可选选题，且没有虚构楼宇事实。
- 用户选择后，能生成三渠道文案与至少 2 个海报方案。
- 能创建公众号测试草稿，但不自动群发。
- 能导出朋友圈和小红书素材。

## 7. 两周落地安排

| 时间 | 交付 |
| --- | --- |
| 第 1-2 天 | 导入 5 个 Skill，验证 Python、Bun、Chrome、图像模型和公众号测试号。 |
| 第 3-4 天 | 接通 Hermes 的飞书/文件读取 MCP，准备一个上海楼宇项目资料包。 |
| 第 5-6 天 | 配置上海的社交、城市新闻、政府政策来源，跑出第一份信号报告。 |
| 第 7-8 天 | 跑通“选题 -> 多渠道文案 -> 海报”的人工审核闭环。 |
| 第 9-10 天 | 跑通公众号草稿创建，完成 3 次真实内容演练并记录问题。 |

## 8. 实施中禁止的做法

- 不把城市、楼宇卖点、联系方式写死在 Skill。
- 不把政府政策当成娱乐热点，不省略原文链接和发布日期。
- 不让 Agent 对未确认的面积、租金、交通、配套作补全。
- 不在未审核状态下自动群发公众号或自动发布小红书。
- 不在 P0 为此新建工作台、RAGFlow 或新的知识库系统。

## 9. 上游安装说明

- 热点 Skill 安装和依赖说明：https://github.com/cclank/news-aggregator-skill
- Marketing Skills 的 `npx skills` 安装说明：https://github.com/coreyhaines31/marketingskills#installation
- Baoyu Skills 的安装和公众号配置说明：https://github.com/JimLiu/baoyu-skills

## 10. Skill 验证与验收

不要以“目录里有 `SKILL.md`”作为验收。每个 Skill 都必须完成一次真实输入、可检查输出和人工判定。

### 10.1 每次测试强制输出执行轨迹

每个测试指令的开头都加上以下要求：

```text
输出执行轨迹。每一步必须写明：调用的 Skill 名称、输入摘要、输出文件或内容、原始证据链接、待人工确认项。
不要调用未指定的 Skill；没有证据时明确写“未找到”，不能编造。
```

预期轨迹格式：

| 步骤 | Skill | 输入 | 结果 | 可核查证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | `news-aggregator-skill` | 城市、时间范围、关键词、来源 | 信号清单 | 每条原始链接 | 待审核/通过 |
| 2 | `content-strategy` | 信号清单、项目事实 | 3 个选题 | 信号链接和项目资料位置 | 待选择 |
| 3 | `copywriting` | 已选选题、项目事实、渠道 | 三渠道文案 | 事实清单 | 待审核 |
| 4 | `baoyu-cover-image` | 已审文案、视觉约束 | 视觉方案/图片文件 | 图片路径 | 待选择 |
| 5 | `baoyu-post-to-wechat` | 已审公众号正文和封面 | 公众号草稿 | 草稿标题或后台状态 | 待发布 |

### 10.2 准备固定测试资料

使用一个真实但可公开的楼宇项目，或一份脱敏测试资料。资料必须写明以下字段，作为后续事实核验的唯一基准：

```text
城市：
项目名称：
地址/商圈：
目标租户：
可公开的面积、价格或租期信息：
真实卖点：
可公开的配套和交通信息：
品牌语气：
禁用词和不可宣传内容：
预约方式：
```

将它作为飞书文档、附件或直接文本发给 Hermes。测试过程中，所有项目事实只能来自这份资料。

### 10.3 单项测试 1：热点与官方信号采集

在 Hermes 对话中发送：

```text
只使用 news-aggregator-skill，执行热点采集测试。
城市：[城市名]；时间范围：近 24 小时；关键词：办公楼、总部经济、产业园、[项目所属行业]。

分别输出：
1. 至少 5 条社交/新闻热点；
2. 至少 2 条官方政策或官方新闻；
3. 每条必须包含标题、来源、发布日期或抓取时间、原始链接、与楼宇营销的相关性判断。

官方政策与社交热点必须分组。没有可靠官方来源时直接标记“未找到”。
输出执行轨迹。不要写营销文案，不要生成图片。
```

通过标准：

- 社交/新闻与官方信息分开呈现。
- 每一条都有可打开的原始链接，且日期在指定范围内。
- 官方信息包含发文机关和发布日期。
- 随机打开 3 条链接，标题和来源能对上；有 1 条不符即本轮不通过。

如果官方信息为空：先在热点 Skill 的 `user_sources.opml` 加入该城市政府门户、住建、规划资源、商务或发改部门的 RSS/新闻页，再重跑。政府来源是采集配置，不是额外的营销 Skill。

### 10.4 单项测试 2：从信号到选题

将 10.3 通过的信号清单和项目资料一起发给 Hermes：

```text
只使用 content-strategy，执行选题测试。
读取以下项目资料：[链接或附件]。
使用我提供的热点与官方信号，给出 3 个楼宇营销选题。

每个选题必须包含：
- 标题；
- 关联信号的原始链接；
- 关联的项目事实及其资料出处；
- 推荐渠道；
- 风险提示。

禁止补写项目资料中没有的租金、面积、交通、企业客户或政策结论。
输出执行轨迹，不要写完整正文。
```

通过标准：3 个选题均能同时对应至少 1 条外部信号和 1 条项目事实；没有夸大和虚构；政策类选题明确标识适用范围和风险。

### 10.5 单项测试 3：多渠道文案

选择一个选题后发送：

```text
只使用 copywriting，执行文案测试。
选题：[选题名称]。
项目资料：[链接或附件]。

生成待审核内容：
1. 公众号：3 个标题、摘要、正文、行动引导；
2. 小红书：3 个标题、正文、5 个以内标签；
3. 朋友圈：一条不超过 80 字的转发文案。

所有楼宇事实必须附资料出处；引用新闻或政策必须保留原始链接。
不要发布，不要生成图片。输出执行轨迹。
```

通过标准：渠道语气有区分；标题、正文、行动引导完整；禁用词不存在；逐项核对项目资料后无新增事实。

### 10.6 单项测试 4：海报视觉

```text
只使用 baoyu-cover-image，执行视觉测试。
基于这份已确认文案：[粘贴确认后的主标题、一个卖点、行动引导]。

生成 2 个楼宇营销视觉方案：1080 x 1440，现代商务风，留出顶部 20% 和底部 25% 的无干扰排版区域。
主体必须是楼宇或真实办公场景，不使用与项目无关的地标建筑。
图片中不生成大段中文文字、二维码、价格或电话号码。输出图片文件和执行轨迹。
```

通过标准：两张图片均能打开、比例正确、视觉主体清晰、底图留有文字安全区、没有乱码或虚构的楼宇标识。

重要边界：此 Skill 负责主视觉生成，不应单独承担复杂中文排版。正式海报的标题、卖点和二维码应在后续可编辑画布中叠加；否则中文排版质量不可稳定验收。

### 10.7 单项测试 5：公众号草稿

先使用测试公众号，不使用生产账号。发送：

```text
只使用 baoyu-post-to-wechat，执行发布测试。
使用以下已审核的标题、摘要、正文和封面图片：[内容与路径]。
只创建公众号草稿，不群发、不预览发送、不修改任何已有草稿。
完成后返回草稿标题、创建时间、后台状态和执行轨迹。
```

通过标准：运营人员能在公众号后台看到标题、正文、封面正确的草稿；没有任何群发记录。草稿创建失败时，记录 API 或 Chrome 登录态错误后停止，不重复提交。

### 10.8 端到端验收

五个单项均通过后，用以下指令跑一次完整流程：

```text
执行一次完整营销内容测试。
城市：[城市]；项目资料：[链接或附件]；目标：[招商获客]；渠道：[公众号、小红书、朋友圈]。

依次调用：news-aggregator-skill、content-strategy、copywriting、baoyu-cover-image、baoyu-post-to-wechat。
每一步停在需要人工确认处：
1. 信号清单后；
2. 选题后；
3. 文案和海报后；
4. 仅在我明确确认后创建公众号草稿。

全程输出执行轨迹和来源链接。小红书、朋友圈只导出素材，不自动发布。
```

验收结论只有三种：

- **通过**：五个节点都有可核查结果，公众号只生成草稿，项目事实零虚构。
- **部分通过**：明确记录失败节点和原因，例如政府源未配置、图像模型不可用、公众号未登录。
- **不通过**：无来源链接、项目事实虚构、自动发布、或无法追溯实际调用的 Skill。
