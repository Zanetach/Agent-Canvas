const CATEGORY = "BeeMax 商业海报";
const POSTER_FORMAT = Object.freeze({ aspectRatio: "3:4", width: 1080, height: 1440 });

const COMMON_INSTRUCTIONS = `生成一张全新的中文竖版商业信息海报。若提供了参考图片，只继承参考图的视觉语言；未提供参考图时，直接按照固定风格生成。

只继承参考图的视觉语言，包括：配色体系、排版节奏、信息层级、网格结构、卡片造型、图标风格、字体气质、留白比例、材质和光影方向。

不要复制参考图中的品牌 Logo、原始文字、数字、学校标志、人物、建筑主体或其他具体内容。

画面比例 ${POSTER_FORMAT.aspectRatio}，输出 ${POSTER_FORMAT.width}×${POSTER_FORMAT.height}。采用严格的模块化网格和自上而下的信息阅读顺序。标题醒目，数字和日期具有最高视觉优先级。图标采用统一线宽和统一造型。背景照片必须经过品牌色覆盖，与文字自然融合。画面精致、现代、克制、商业化，具有成熟品牌设计感。

Logo 使用真实透明 PNG 后期叠加，不要在生成图片中伪造或重绘 Logo。所有文字必须严格使用 CONTENT，不得自行编造数据、法规、排名、收益、学校信息或产品承诺。`;

const AVOID = `【避免】
避免改变主色体系、排版风格和光影方向；
避免随机增加颜色、装饰和信息模块；
避免伪造 Logo、乱码、错别字、无关英文、水印；
避免廉价渐变、夸张 3D、卡通图标、文字拥挤和层级混乱。`;

const POSTER_PRESETS = Object.freeze([
  {
    id: "beemax-poster-emerald-data",
    name: "翡翠绿企业数据风",
    category: CATEGORY,
    coverUrl: "",
    sortOrder: 10,
    enabled: true,
    styleLock: `翡翠绿和青绿色单色体系，明暗渐变背景；
局部使用半透明绿色几何面板和轻微玻璃质感；
底部融入低对比度现代建筑照片，覆盖绿色滤镜；
使用粗体中文无衬线字体和超大白色数字；
关键数据采用左右双栏结构，以细竖线分隔；
搭配美元、增长、排名等简洁白色线性图标；
整体像大型保险金融集团的年度数据报告，稳健、清晰、国际化，不使用金色、红色或复杂装饰。`,
  },
  {
    id: "beemax-poster-ivory-legal",
    name: "象牙白海军蓝法律风",
    category: CATEGORY,
    coverUrl: "",
    sortOrder: 20,
    enabled: true,
    styleLock: `温暖象牙白纸张背景，深海军蓝为主文字色，以克制的香槟金作为描边和重点色；
顶部采用盾牌、天平等精致徽章图标；
主标题使用端庄的中文宋体或现代衬线字体；
内容采用三组横向圆角信息卡片，左侧圆形图标，中间编号，右侧标题与说明；
底部使用金色细线框出的法规或说明区域；
边缘加入海军蓝与金色弧形装饰；
整体呈现高端法律、保险、财富传承手册质感。`,
  },
  {
    id: "beemax-poster-navy-admissions",
    name: "深蓝金色招生紧迫风",
    category: CATEGORY,
    coverUrl: "",
    sortOrder: 30,
    enabled: true,
    styleLock: `深海军蓝渐变背景，白色和暖金色为主要文字色，少量高饱和红色只用于关键截止日期；
背景融入香港城市天际线和校园建筑照片，使用蓝色覆盖和右上方暖金色聚光；
顶部使用超大、紧凑、粗体中文标题，部分关键词使用金色突出；
中部放置米白色圆角日期卡片；
下部为四列金色线性图标利益点；
行动号召采用具有力量感的中文书法字，配合红色下划线或感叹号；
整体具有高转化招生广告的紧迫感和高级感。`,
  },
].map((preset) => Object.freeze(preset)));

const CONTENT_FIELDS = Object.freeze([
  ["主题", "行业主题"],
  ["品牌名称", "品牌名称"],
  ["主标题", "主标题"],
  ["副标题", "副标题"],
  ["核心数据", "核心数字或日期"],
  ["信息模块一", "信息模块一"],
  ["信息模块二", "信息模块二"],
  ["信息模块三", "信息模块三"],
  ["CTA", "行动号召"],
  ["合规文字", "免责声明"],
]);

function stylePrompt(preset) {
  return `${COMMON_INSTRUCTIONS}

【固定风格 STYLE LOCK】
${preset.styleLock}

将用户当前输入的文字视为 CONTENT；固定风格不得修改，只替换内容。后续版本以上一次确认的成品作为新参考图。

${AVOID}`;
}

export function listPosterStyles(category = "") {
  return POSTER_PRESETS
    .filter((preset) => !category || preset.category === category)
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      category: preset.category,
      coverUrl: preset.coverUrl,
      sortOrder: preset.sortOrder,
      enabled: preset.enabled,
      prompt: stylePrompt(preset),
    }));
}

export function renderPosterPrompt(styleId, content, brief = "") {
  const preset = POSTER_PRESETS.find((candidate) => candidate.id === styleId);
  if (!preset) {
    const error = new Error(`未知商业海报风格：${styleId || "未指定"}`);
    error.statusCode = 422;
    throw error;
  }
  const values = content && typeof content === "object" ? content : {};
  const briefText = String(brief || "").trim();
  if (/\{\{|\}\}|待填写|待补充|\bTBD\b|placeholder/i.test(briefText)) {
    const error = new Error("用户需求仍包含占位符");
    error.statusCode = 422;
    throw error;
  }
  const placeholders = CONTENT_FIELDS
    .map(([key]) => key)
    .filter((key) => /\{\{|\}\}|待填写|待补充|\bTBD\b|placeholder/i.test(String(values[key] ?? "")));
  if (placeholders.length) {
    const error = new Error(`CONTENT 仍包含占位符：${placeholders.join("、")}`);
    error.statusCode = 422;
    throw error;
  }
  if (briefText) {
    const structuredLines = CONTENT_FIELDS
      .filter(([key]) => String(values[key] ?? "").trim())
      .map(([key, label]) => `${label}：${String(values[key]).trim()}`);
    const contentBlock = [
      `用户原始需求：${briefText}`,
      ...(structuredLines.length
        ? ["", "用户补充的结构化信息：", ...structuredLines]
        : []),
    ].join("\n");
    return {
      style_id: preset.id,
      style_name: preset.name,
      aspect_ratio: POSTER_FORMAT.aspectRatio,
      width: POSTER_FORMAT.width,
      height: POSTER_FORMAT.height,
      prompt: `${COMMON_INSTRUCTIONS}

【固定风格 STYLE LOCK】
${preset.styleLock}

【内容变量 CONTENT】
${contentBlock}

只允许使用用户原始需求和补充信息中明确提供的文字、名称、数字、日期和事实。未明确提供的信息必须省略，不得补造、推断或使用占位符。可以组织版式，但不得改变事实或数字。

${AVOID}`,
    };
  }
  const missing = CONTENT_FIELDS
    .map(([key]) => key)
    .filter((key) => !String(values[key] ?? "").trim());
  if (missing.length) {
    const error = new Error(`缺少 CONTENT 字段：${missing.join("、")}`);
    error.statusCode = 422;
    throw error;
  }
  const contentBlock = CONTENT_FIELDS
    .map(([key, label]) => `${label}：${String(values[key]).trim()}`)
    .join("\n");
  return {
    style_id: preset.id,
    style_name: preset.name,
    aspect_ratio: POSTER_FORMAT.aspectRatio,
    width: POSTER_FORMAT.width,
    height: POSTER_FORMAT.height,
    prompt: `${COMMON_INSTRUCTIONS}

【固定风格 STYLE LOCK】
${preset.styleLock}

【内容变量 CONTENT】
${contentBlock}

所有画面文字必须严格使用以上 CONTENT，不得添加、改写或推断任何信息。

${AVOID}`,
  };
}
