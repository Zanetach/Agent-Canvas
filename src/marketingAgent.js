import crypto from "node:crypto";

export const sampleKnowledgeBase = {
  id: "kb_building_demo",
  scenario: "building_leasing",
  brandProfile: {
    name: "城芯办公顾问",
    tone: "专业、轻松、有城市感",
    colors: ["#12372A", "#E9C46A", "#F7F3E8"],
    cta: "预约看房或添加顾问微信"
  },
  entities: [
    {
      id: "entity_green_tower",
      type: "building",
      name: "绿洲中心",
      attributes: {
        city: "上海",
        business_area: "南京西路",
        metro: "2号线步行3分钟",
        rent_price: "7.5元/㎡/天",
        area_range: "200-2000㎡",
        contact: "张顾问 138-0000-0000"
      },
      selling_points: ["地铁近", "24小时安保", "大堂空间适合活动", "周边餐饮丰富", "适合科技、咨询、直播、电商企业"],
      proof_points: ["实景大堂照片", "可租面积200-2000㎡", "步行3分钟到地铁站"],
      assets: {
        logo: "asset://brand-logo",
        qrcode: "asset://consultant-qrcode",
        images: ["asset://building-lobby"]
      },
      constraints: {
        forbidden_claims: ["全上海最低价", "100%成交"],
        must_include: ["联系方式"]
      }
    }
  ]
};

export const sampleTrends = [
  {
    id: "trend_world_cup",
    title: "世界杯决赛临近，城市看球氛围升温",
    source: "demo:sports",
    category: "sports",
    url: "https://example.com/world-cup",
    scores: { heat: 92, timeliness: 95, marketing_potential: 88, risk: 12 },
    risk_level: "low"
  },
  {
    id: "trend_heatwave",
    title: "高温天气持续，通勤体验成为白领热议话题",
    source: "demo:weather",
    category: "weather",
    url: "https://example.com/weather",
    scores: { heat: 78, timeliness: 91, marketing_potential: 80, risk: 18 },
    risk_level: "low"
  },
  {
    id: "trend_city_event",
    title: "上海核心商圈夜间消费热度上升",
    source: "demo:city",
    category: "city",
    url: "https://example.com/city",
    scores: { heat: 84, timeliness: 82, marketing_potential: 86, risk: 15 },
    risk_level: "low"
  }
];

export function planMarketing(request) {
  return {
    marketing_brief_id: id("brief"),
    scenario: request.scenario ?? "building_leasing",
    primary_goal: request.marketing_goal ?? "lead_generation",
    secondary_goals: ["sales_enablement", "private_domain_sharing"],
    funnel_stage: "interest",
    target_channels: request.target_channels ?? ["xiaohongshu", "wechat_official_account", "moments"],
    content_mix: [
      { type: "trend_hook", purpose: "借热点获得注意力", channels: ["xiaohongshu", "moments"] },
      { type: "educational", purpose: "解释选择逻辑并建立信任", channels: ["wechat_official_account"] }
    ],
    success_metrics: ["views", "saves", "shares", "qr_scans", "inquiries"],
    cta: "预约看房或添加顾问微信"
  };
}

export function profileAudience() {
  return [
    {
      id: "aud_admin",
      name: "企业行政负责人",
      role: "influencer",
      pain_points: ["通勤便利", "活动组织", "员工体验", "预算可控"],
      motivations: ["降低沟通成本", "提升办公体验", "方便组织团队活动"],
      objections: ["价格是否超预算", "交通是否真的方便", "配套是否稳定"],
      proof_needed: ["地铁距离", "实景照片", "可用面积", "配套清单"],
      message_angles: ["通勤效率", "团队活动", "空间体验"]
    },
    {
      id: "aud_owner",
      name: "企业老板",
      role: "decision_maker",
      pain_points: ["企业形象", "租赁成本", "团队稳定", "业务增长弹性"],
      motivations: ["用空间提升公司形象", "给团队更稳定的办公环境"],
      objections: ["投入产出是否合理", "搬迁是否麻烦"],
      proof_needed: ["区位价值", "面积弹性", "客户接待场景"],
      message_angles: ["企业主场", "长期成本", "商务形象"]
    }
  ];
}

export function collectTrends(request) {
  const categories = request.trend_scope?.categories;
  const trends = categories?.length
    ? sampleTrends.filter((trend) => categories.includes(trend.category))
    : sampleTrends;
  return {
    trends,
    diagnostics: {
      sources_used: ["demo:sports", "demo:weather", "demo:city"],
      failed_sources: []
    }
  };
}

export function analyzeKnowledge(knowledgeBase = sampleKnowledgeBase) {
  return {
    knowledge_entities: knowledgeBase.entities,
    brand_profile: knowledgeBase.brandProfile,
    scenario_config: {
      scenario: knowledgeBase.scenario,
      entity_types: ["building"],
      marketing_goals: ["lead_generation", "sales_enablement"],
      default_channels: ["xiaohongshu", "wechat_official_account", "moments"],
      preferred_angles: ["commute", "city_event", "team_activity", "business_district"]
    },
    asset_inventory: knowledgeBase.entities.flatMap((entity) => entity.assets.images),
    missing_fields: [],
    quality_warnings: []
  };
}

export function generateTopics(trends, knowledge, audiences) {
  const entity = knowledge.knowledge_entities[0];
  return trends.map((trend, index) => {
    const isSports = trend.category === "sports";
    const angle = isSports
      ? "把世界杯看球夜转成企业团队活动和办公空间体验"
      : trend.category === "weather"
        ? "从高温通勤讨论切入地铁近和配套完善的办公体验"
        : "借商圈热度讲企业选址和城市商务活力";
    const total = Math.round(
      trend.scores.heat * 0.2 +
        trend.scores.timeliness * 0.15 +
        82 * 0.25 +
        84 * 0.2 +
        86 * 0.1 +
        88 * 0.1 -
        trend.scores.risk * 0.3
    );

    return {
      id: `topic_${String(index + 1).padStart(3, "0")}`,
      trend_id: trend.id,
      trend_title: trend.title,
      entity_ids: [entity.id],
      audience_ids: audiences.map((audience) => audience.id),
      trend_hook: trend.title,
      business_claim: `${entity.name}具备${entity.selling_points.slice(0, 3).join("、")}等办公场景优势。`,
      angle,
      reasoning: "该热点能自然连接企业空间、员工体验和销售转发场景。",
      recommended_channels: ["xiaohongshu", "wechat_official_account", "moments"],
      creative_direction: {
        poster_type: "event_hook",
        visual_mood: "城市夜晚、商务空间、轻松但专业"
      },
      scores: {
        total,
        trend_heat: trend.scores.heat,
        knowledge_relevance: 82,
        conversion_potential: 84,
        risk: trend.scores.risk
      },
      risk_notes: []
    };
  }).sort((a, b) => b.scores.total - a.scores.total);
}

export function writeCopy(topic, knowledge) {
  const entity = knowledge.knowledge_entities[0];
  const contact = entity.attributes.contact;
  return {
    copy_set_id: id("copy"),
    topic_id: topic.id,
    channels: {
      xiaohongshu: {
        titles: ["世界杯决赛夜，公司看球到底该在哪？", "办公室不只用来上班，也能承载团队高光时刻"],
        body: `世界杯决赛临近，很多公司又开始讨论“团队一起看球”这件事。\n\n真正好用的办公空间，不只看租金和面积，也要看公共空间、交通、夜间安保和周边配套。\n\n${entity.name}位于${entity.attributes.business_area}，${entity.attributes.metro}，适合需要兼顾通勤效率和团队活动的企业。\n\n${contact}`,
        hashtags: ["世界杯", "办公室日常", "上海写字楼", "企业团建", "南京西路"]
      },
      wechat_official_account: {
        title: "世界杯决赛夜背后，企业办公空间正在发生什么变化？",
        digest: "从一次看球夜，看企业办公空间的社交价值和选址逻辑。",
        body_markdown: `# 世界杯决赛夜背后，企业办公空间正在发生什么变化？\n\n世界杯决赛临近，企业内部的看球、团建、夜间活动讨论也会升温。\n\n这类热点提醒我们：办公空间不只是工位和会议室，也承载团队凝聚、客户接待和企业文化表达。\n\n## 选址时值得关注的三个点\n\n1. 通勤是否稳定：${entity.attributes.metro}\n2. 活动是否方便：${entity.selling_points[2]}\n3. 夜间是否安心：${entity.selling_points[1]}\n\n${entity.name}位于${entity.attributes.business_area}，可租面积${entity.attributes.area_range}，适合正在考虑办公升级的企业。\n\n${contact}`
      },
      moments: {
        text: `世界杯决赛夜，不只是看球，也是团队凝聚力的一次小测试。\n\n好的办公空间，不只解决上班，也承载企业的关键时刻。\n${entity.name}｜${entity.attributes.metro}｜${contact}`,
        sales_variants: [
          `客户如果最近在看办公室，可以重点关注：通勤、配套、夜间安保和公共空间。${entity.name}这几个点都比较适合团队型企业。`,
          `借世界杯这个话题，刚好可以聊聊企业办公空间的“活动承载能力”。需要资料可以找我。`
        ]
      }
    },
    verification_notes: []
  };
}

export function generateCreative(topic, copySet, knowledge) {
  const entity = knowledge.knowledge_entities[0];
  const title = copySet.channels.xiaohongshu.titles[0];
  const subtitle = entity.attributes.metro;
  const sellingPoints = entity.selling_points.slice(0, 3);
  const design = {
    design_id: id("creative"),
    template_id: "event_hook_xhs_3_4",
    format: "xhs_3_4",
    canvas: { width: 1080, height: 1440, background: "#F7F3E8" },
    layers: [
      { id: "brand", type: "text", text: knowledge.brand_profile.name, x: 72, y: 72, width: 500, fontSize: 30, locked: false },
      { id: "title", type: "text", text: title, x: 72, y: 150, width: 900, fontSize: 68, locked: false },
      { id: "trend", type: "text", text: topic.trend_hook, x: 72, y: 340, width: 860, fontSize: 32, locked: false },
      { id: "image", type: "shape", text: "楼宇实景图占位", x: 72, y: 430, width: 936, height: 420, locked: false },
      { id: "subtitle", type: "text", text: subtitle, x: 96, y: 900, width: 860, fontSize: 36, locked: false },
      { id: "point_1", type: "text", text: `01 ${sellingPoints[0]}`, x: 96, y: 990, width: 760, fontSize: 34, locked: false },
      { id: "point_2", type: "text", text: `02 ${sellingPoints[1]}`, x: 96, y: 1060, width: 760, fontSize: 34, locked: false },
      { id: "point_3", type: "text", text: `03 ${sellingPoints[2]}`, x: 96, y: 1130, width: 760, fontSize: 34, locked: false },
      { id: "qrcode", type: "qr", text: "扫码咨询", x: 804, y: 1210, width: 150, height: 150, locked: true },
      { id: "contact", type: "text", text: entity.attributes.contact, x: 72, y: 1328, width: 700, fontSize: 28, locked: true }
    ]
  };

  return {
    creative_id: design.design_id,
    design_json: design,
    preview_svg: renderPosterSvg(design),
    export_refs: {
      png: null,
      editable_json: `${design.design_id}.json`
    }
  };
}

export function publishOrExport(copySet, creative) {
  return {
    publish_records: [
      {
        channel: "wechat_official_account",
        mode: "draft",
        status: "ready_to_connect",
        external_id: null,
        next_action: "接入公众号 appid/appsecret 后创建草稿"
      },
      {
        channel: "xiaohongshu",
        mode: "export_package",
        status: "success",
        package: {
          title: copySet.channels.xiaohongshu.titles[0],
          body: copySet.channels.xiaohongshu.body,
          hashtags: copySet.channels.xiaohongshu.hashtags,
          creative_id: creative.creative_id
        }
      },
      {
        channel: "moments",
        mode: "download_package",
        status: "success",
        package: {
          text: copySet.channels.moments.text,
          sales_variants: copySet.channels.moments.sales_variants,
          creative_id: creative.creative_id
        }
      }
    ]
  };
}

export function optimizePerformance() {
  return {
    measurement_plan: {
      tracking: ["campaign_id", "topic_id", "creative_id", "channel", "qr_code"],
      metrics: ["views", "likes", "saves", "shares", "qr_scans", "inquiries"],
      next_review: "发布后24小时和72小时复盘"
    },
    suggested_experiments: ["测试通勤角度 vs 团队活动角度", "测试深色城市夜景版 vs 浅色商务版海报"]
  };
}

export function runMarketingCampaign(request = {}) {
  const marketingBrief = planMarketing(request);
  const audiences = profileAudience(request);
  const trendResult = collectTrends(request);
  const knowledge = analyzeKnowledge(request.knowledge_base ?? sampleKnowledgeBase);
  const topics = generateTopics(trendResult.trends, knowledge, audiences);
  const selectedTopic = topics[0];
  const copySet = writeCopy(selectedTopic, knowledge);
  const creative = generateCreative(selectedTopic, copySet, knowledge);
  const publishPackages = publishOrExport(copySet, creative);
  const performance = optimizePerformance();

  return {
    run_id: id("mkt_run"),
    created_at: new Date().toISOString(),
    scenario: marketingBrief.scenario,
    marketing_brief: marketingBrief,
    audiences,
    trends: trendResult.trends,
    knowledge_summary: {
      entities: knowledge.knowledge_entities.map((entity) => ({ id: entity.id, type: entity.type, name: entity.name })),
      brand_profile: knowledge.brand_profile
    },
    topic_candidates: topics,
    selected_topic: selectedTopic,
    copies: copySet,
    creatives: [creative],
    publish_packages: publishPackages.publish_records,
    measurement_plan: performance.measurement_plan,
    next_required_action: "review"
  };
}

export function renderPosterSvg(design) {
  const get = (id) => design.layers.find((layer) => layer.id === id);
  const title = escapeXml(get("title").text);
  const brand = escapeXml(get("brand").text);
  const trend = escapeXml(get("trend").text);
  const subtitle = escapeXml(get("subtitle").text);
  const points = ["point_1", "point_2", "point_3"].map((key) => escapeXml(get(key).text));
  const contact = escapeXml(get("contact").text);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <rect width="1080" height="1440" fill="#F7F3E8"/>
  <rect x="0" y="0" width="1080" height="16" fill="#12372A"/>
  <text x="72" y="102" fill="#12372A" font-size="30" font-family="Arial, sans-serif" font-weight="700">${brand}</text>
  <text x="72" y="205" fill="#12372A" font-size="68" font-family="Arial, sans-serif" font-weight="800">${title.slice(0, 18)}</text>
  <text x="72" y="288" fill="#12372A" font-size="68" font-family="Arial, sans-serif" font-weight="800">${title.slice(18)}</text>
  <text x="72" y="365" fill="#5A5F58" font-size="32" font-family="Arial, sans-serif">${trend.slice(0, 34)}</text>
  <rect x="72" y="430" width="936" height="420" rx="8" fill="#12372A"/>
  <circle cx="250" cy="610" r="92" fill="#E9C46A"/>
  <rect x="390" y="540" width="420" height="180" rx="8" fill="#F7F3E8" opacity="0.92"/>
  <text x="440" y="640" fill="#12372A" font-size="42" font-family="Arial, sans-serif" font-weight="700">楼宇实景图</text>
  <text x="96" y="936" fill="#12372A" font-size="36" font-family="Arial, sans-serif" font-weight="700">${subtitle}</text>
  <text x="96" y="1024" fill="#12372A" font-size="34" font-family="Arial, sans-serif">${points[0]}</text>
  <text x="96" y="1094" fill="#12372A" font-size="34" font-family="Arial, sans-serif">${points[1]}</text>
  <text x="96" y="1164" fill="#12372A" font-size="34" font-family="Arial, sans-serif">${points[2]}</text>
  <rect x="804" y="1210" width="150" height="150" rx="8" fill="#ffffff" stroke="#12372A" stroke-width="4"/>
  <path d="M828 1234h38v38h-38zM892 1234h38v38h-38zM828 1298h38v38h-38zM884 1300h16v16h-16zM908 1322h22v14h-22z" fill="#12372A"/>
  <text x="810" y="1390" fill="#12372A" font-size="24" font-family="Arial, sans-serif">扫码咨询</text>
  <text x="72" y="1362" fill="#12372A" font-size="28" font-family="Arial, sans-serif">${contact}</text>
</svg>`;
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
