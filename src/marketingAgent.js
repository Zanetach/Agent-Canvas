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
  if (Array.isArray(request.trend_items) && request.trend_items.length) {
    return {
      trends: applyTrendScope(request.trend_items.map(normalizeProvidedTrend), request),
      diagnostics: { sources_used: [...new Set(request.trend_items.map((trend) => trend.source ?? "request"))], failed_sources: [] }
    };
  }
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

export async function collectTrendsLive(request) {
  const diagnostics = {
    sources_used: [],
    failed_sources: []
  };

  if (Array.isArray(request.trend_items) && request.trend_items.length) {
    return {
      trends: applyTrendScope(request.trend_items.map(normalizeProvidedTrend), request),
      diagnostics: {
        sources_used: [...new Set(request.trend_items.map((trend) => trend.source ?? "request"))],
        failed_sources: [],
        supplied_by_request: true
      }
    };
  }

  const apiBase = (request.trend_api_base ?? process.env.DAILYHOT_API_BASE_URL ?? "https://api-hot.imsyy.top").replace(/\/$/, "");
  const sources = request.trend_scope?.sources ?? ["baidu", "weibo", "zhihu", "36kr"];
  const sourceResults = await Promise.allSettled(
    sources.map(async (source) => ({
      source,
      trends: await fetchDailyHotSource(`${apiBase}/${source}`, `dailyhot:${source}`)
    }))
  );

  const aggregated = [];
  sourceResults.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled") {
      diagnostics.sources_used.push(`dailyhot:${source}`);
      aggregated.push(...result.value.trends);
      return;
    }
    diagnostics.failed_sources.push({ source: `dailyhot:${source}`, reason: result.reason.message });
  });

  if (aggregated.length) {
    return {
      trends: applyTrendScope(dedupeTrends(aggregated), request),
      diagnostics
    };
  }

  try {
    const baidu = await fetchBaiduHotPage();
    diagnostics.sources_used.push("baidu:hot-page");
    return {
      trends: applyTrendScope(baidu, request),
      diagnostics
    };
  } catch (error) {
    diagnostics.failed_sources.push({ source: "baidu:hot-page", reason: error.message });
  }

  const fallback = collectTrends(request);
  return {
    trends: fallback.trends,
    diagnostics: {
      sources_used: fallback.diagnostics.sources_used,
      failed_sources: diagnostics.failed_sources,
      fallback_used: true
    }
  };
}

export function resolveKnowledgeBase(request = {}) {
  if (request.knowledge_base) return request.knowledge_base;
  if (Array.isArray(request.knowledge_documents) && request.knowledge_documents.length) {
    return knowledgeBaseFromDocuments(request);
  }
  return sampleKnowledgeBase;
}

export function knowledgeBaseFromDocuments(request = {}) {
  const documents = request.knowledge_documents ?? [];
  const content = documents.map((document) => document.content ?? "").join("\n");
  const facts = extractDocumentFacts(content);
  const sellingPoints = extractListFact(content, ["卖点", "核心卖点", "优势", "项目亮点"]);
  const proofPoints = extractListFact(content, ["证明材料", "证明", "依据", "实拍", "配套"]);
  const entityName = facts.name ?? request.entity_name ?? "待确认项目";

  return {
    id: request.knowledge_base_id ?? id("kb_document"),
    scenario: request.scenario ?? "building_leasing",
    brandProfile: request.brand_profile ?? {
      name: facts.brand ?? "营销内容助手",
      tone: "专业、可信、克制",
      colors: ["#12372A", "#E9C46A", "#F7F3E8"],
      cta: facts.cta ?? "预约咨询"
    },
    entities: [
      {
        id: id("entity"),
        type: "building",
        name: entityName,
        attributes: {
          city: facts.city ?? "待确认城市",
          business_area: facts.business_area ?? facts.address ?? "待确认商圈",
          metro: facts.metro ?? "交通信息待确认",
          rent_price: facts.rent_price ?? "租金待确认",
          area_range: facts.area_range ?? "面积待确认",
          contact: facts.contact ?? "联系方式待确认"
        },
        selling_points: sellingPoints.length ? sellingPoints : ["楼宇资料待补充"],
        proof_points: proofPoints,
        source_refs: documents.map((document) => ({ name: document.name ?? "未命名资料", type: document.type ?? "text" })),
        assets: {
          logo: "asset://brand-logo",
          qrcode: "asset://consultant-qrcode",
          images: ["asset://building-lobby"]
        },
        constraints: {
          forbidden_claims: request.forbidden_claims ?? [],
          must_include: facts.contact ? ["联系方式"] : []
        }
      }
    ]
  };
}

export function analyzeKnowledge(knowledgeBase = sampleKnowledgeBase) {
  const entity = knowledgeBase.entities[0];
  const missingFields = ["city", "business_area", "metro", "contact"].filter((field) => {
    const value = entity?.attributes?.[field];
    return !value || /待确认/.test(value);
  });
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
    asset_inventory: knowledgeBase.entities.flatMap((item) => item.assets?.images ?? []),
    source_refs: knowledgeBase.entities.flatMap((item) => item.source_refs ?? []),
    missing_fields: missingFields,
    quality_warnings: missingFields.length ? [`以下事实未确认：${missingFields.join("、")}`] : []
  };
}

export function generateTopics(trends, knowledge, audiences) {
  const entity = knowledge.knowledge_entities[0];
  return trends.map((trend, index) => {
    const isSports = trend.category === "sports";
    const angle = isSports
      ? "把体育强队协作热点转成企业团队主场和办公空间体验"
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
      category: trend.category,
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
  const hook = topic.trend_hook;
  const isSports = topic.category === "sports" || /世界杯|足球|法国队|姆巴佩|登贝莱|夺冠|强队/.test(hook);
  const xhsTitle = isSports ? "强队需要主场，公司也一样" : "办公室选址，别只看租金";
  const wechatTitle = isSports ? "从强队协作到企业主场：办公空间为什么越来越重要？" : "一次热点背后，企业选址真正该看什么？";
  const opening = isSports
    ? `今天的热点是「${hook}」。体育比赛讲配合、节奏和主场，企业团队其实也一样。`
    : `今天的热点是「${hook}」。这类讨论背后，能看到企业办公对通勤、配套和空间稳定性的真实需求。`;
  return {
    copy_set_id: id("copy"),
    topic_id: topic.id,
    channels: {
      xiaohongshu: {
        titles: [xhsTitle, "办公室不只用来上班，也能承载团队高光时刻"],
        body: `${opening}\n\n真正好用的办公空间，不只看租金和面积，也要看公共空间、交通、夜间安保和周边配套。\n\n${entity.name}位于${entity.attributes.business_area}，${entity.attributes.metro}，适合需要兼顾通勤效率和团队活动的企业。\n\n${contact}`,
        hashtags: ["办公室日常", "上海写字楼", "企业选址", "企业团队", "南京西路"]
      },
      wechat_official_account: {
        title: wechatTitle,
        digest: "从热点看企业办公空间的团队价值和选址逻辑。",
        body_markdown: `# ${wechatTitle}\n\n${opening}\n\n这类热点提醒我们：办公空间不只是工位和会议室，也承载团队凝聚、客户接待和企业文化表达。\n\n## 选址时值得关注的三个点\n\n1. 通勤是否稳定：${entity.attributes.metro}\n2. 活动是否方便：${entity.selling_points[2]}\n3. 夜间是否安心：${entity.selling_points[1]}\n\n${entity.name}位于${entity.attributes.business_area}，可租面积${entity.attributes.area_range}，适合正在考虑办公升级的企业。\n\n${contact}`
      },
      moments: {
        text: `${hook}\n\n好的团队需要主场，好的办公空间也不只解决上班。\n${entity.name}｜${entity.attributes.metro}｜${contact}`,
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
  const title = copySet.channels.xiaohongshu.titles[0].replace("，公司也一样", "");
  const subtitle = entity.attributes.metro;
  const sellingPoints = entity.selling_points.slice(0, 3);
  const design = {
    design_id: id("creative"),
    template_id: "architectural_editorial_xhs_3_4",
    format: "xhs_3_4",
    canvas: { width: 1080, height: 1440, background: "#10191D" },
    layers: [
      { id: "hero", type: "image", asset_ref: "office-building-dusk-v1.png", x: 0, y: 0, width: 1080, height: 1440, locked: false },
      { id: "brand", type: "text", text: knowledge.brand_profile.name, x: 72, y: 76, width: 500, fontSize: 28, locked: false },
      { id: "title", type: "text", text: title, x: 72, y: 160, width: 880, fontSize: 76, locked: false },
      { id: "trend", type: "text", text: topic.trend_hook, x: 72, y: 360, width: 800, fontSize: 30, locked: false },
      { id: "building", type: "text", text: entity.name, x: 72, y: 1050, width: 560, fontSize: 44, locked: false },
      { id: "subtitle", type: "text", text: subtitle, x: 72, y: 1110, width: 700, fontSize: 30, locked: false },
      { id: "point_1", type: "text", text: sellingPoints[0], x: 72, y: 1180, width: 700, fontSize: 30, locked: false },
      { id: "point_2", type: "text", text: sellingPoints[1], x: 72, y: 1232, width: 700, fontSize: 30, locked: false },
      { id: "point_3", type: "text", text: sellingPoints[2], x: 72, y: 1284, width: 700, fontSize: 30, locked: false },
      { id: "qrcode", type: "qr", text: "扫码咨询", x: 826, y: 1134, width: 156, height: 156, locked: true },
      { id: "contact", type: "text", text: entity.attributes.contact, x: 72, y: 1362, width: 700, fontSize: 27, locked: true }
    ],
    export_refs: {
      preview: "poster.png",
      editable_json: "poster-editable.json"
    }
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
  const knowledgeBase = resolveKnowledgeBase(request);
  const knowledge = analyzeKnowledge(knowledgeBase);
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
      brand_profile: knowledge.brand_profile,
      source_refs: knowledge.source_refs,
      quality_warnings: knowledge.quality_warnings
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

export async function runMarketingCampaignLive(request = {}) {
  const trace = [];
  const startedAt = new Date().toISOString();
  const marketingBrief = planMarketing(request);
  trace.push(traceStep("marketing-planner", "确定营销目标、渠道角色、CTA 与成功指标", request, marketingBrief));

  const audiences = profileAudience(request);
  trace.push(traceStep("marketing-audience-profiler", "拆分决策人、影响者和转发人，明确痛点与证明材料", { scenario: marketingBrief.scenario }, audiences));

  const trendResult = await collectTrendsLive(request);
  trace.push(traceStep("marketing-trend-collector", "聚合 DailyHotApi 配置来源；不可用时回退百度热搜页面，并过滤高风险热点", request.trend_scope, trendResult));

  const knowledgeBase = resolveKnowledgeBase(request);
  const knowledge = analyzeKnowledge(knowledgeBase);
  trace.push(traceStep("marketing-knowledge-analyzer", "抽取楼宇实体、卖点、资产、约束和品牌语气", { knowledge_base_id: knowledgeBase.id, source_document_count: request.knowledge_documents?.length ?? 0 }, knowledge));

  const topics = generateTopics(trendResult.trends, knowledge, audiences);
  const selectedTopic = topics[0];
  trace.push(traceStep("marketing-topic-strategist", "对热点和知识库做匹配评分，选择低风险且能带出卖点的选题", { trend_count: trendResult.trends.length }, { selectedTopic, topTopics: topics.slice(0, 5) }));

  const copySet = writeCopy(selectedTopic, knowledge);
  trace.push(traceStep("marketing-copywriter", "生成小红书、公众号、朋友圈和销售转发话术", { topic_id: selectedTopic.id }, copySet));

  const creative = generateCreative(selectedTopic, copySet, knowledge);
  trace.push(traceStep("marketing-creative-generator", "生成可编辑海报 JSON，并渲染 SVG/PNG", { copy_set_id: copySet.copy_set_id }, { creative_id: creative.creative_id, template_id: creative.design_json.template_id, layer_count: creative.design_json.layers.length }));

  const publishPackages = publishOrExport(copySet, creative);
  trace.push(traceStep("marketing-channel-publisher", "生成公众号草稿占位、小红书发布包、朋友圈下载包", { review_status: "pending" }, publishPackages));

  const performance = optimizePerformance();
  trace.push(traceStep("marketing-performance-optimizer", "给出发布后的指标回收计划和 A/B 测试建议", { channels: marketingBrief.target_channels }, performance));

  return {
    run_id: id("mkt_run"),
    created_at: startedAt,
    scenario: marketingBrief.scenario,
    marketing_brief: marketingBrief,
    audiences,
    trends: trendResult.trends,
    trend_diagnostics: trendResult.diagnostics,
    knowledge_summary: {
      entities: knowledge.knowledge_entities.map((entity) => ({ id: entity.id, type: entity.type, name: entity.name })),
      brand_profile: knowledge.brand_profile,
      source_refs: knowledge.source_refs,
      quality_warnings: knowledge.quality_warnings
    },
    topic_candidates: topics,
    selected_topic: selectedTopic,
    copies: copySet,
    creatives: [creative],
    publish_packages: publishPackages.publish_records,
    measurement_plan: performance.measurement_plan,
    trace,
    next_required_action: "review"
  };
}

export function renderPosterSvg(design) {
  const get = (id) => design.layers.find((layer) => layer.id === id);
  const brand = escapeXml(get("brand").text);
  const building = escapeXml(get("building")?.text ?? "推荐楼宇");
  const subtitle = escapeXml(get("subtitle").text);
  const points = ["point_1", "point_2", "point_3"].map((key) => escapeXml(get(key).text));
  const contact = escapeXml(get("contact").text);
  const titleLines = wrapCjk(get("title").text, 11).slice(0, 2).map(escapeXml);
  const trendLines = wrapCjk(get("trend").text, 22).slice(0, 2).map(escapeXml);
  const hero = get("hero");
  const heroSrc = escapeXml(hero?.asset_ref ?? "office-building-dusk-v1.png");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <defs>
    <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#071218" stop-opacity="0.94"/>
      <stop offset="54%" stop-color="#071218" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#071218" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#071218" stop-opacity="0"/>
      <stop offset="34%" stop-color="#071218" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#071218" stop-opacity="0.97"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1440" fill="#10191D"/>
  <image href="${heroSrc}" x="0" y="0" width="1080" height="1440" preserveAspectRatio="xMidYMid slice"/>
  <rect width="1080" height="760" fill="url(#topShade)"/>
  <rect y="760" width="1080" height="680" fill="url(#bottomShade)"/>
  <rect x="72" y="76" width="10" height="28" fill="#D8B76A"/>
  <text x="102" y="100" fill="#F7F2E8" font-size="28" font-family="Arial, 'Noto Sans SC', sans-serif" font-weight="700">${brand}</text>
  ${titleLines.map((line, index) => `<text x="72" y="${220 + index * 92}" fill="#FFFFFF" font-size="76" font-family="Arial, 'Noto Sans SC', sans-serif" font-weight="900">${line}</text>`).join("\n  ")}
  <line x1="72" y1="${390 + titleLines.length * 92}" x2="202" y2="${390 + titleLines.length * 92}" stroke="#D8B76A" stroke-width="5"/>
  ${trendLines.map((line, index) => `<text x="72" y="${452 + titleLines.length * 92 + index * 40}" fill="#E6E9E5" font-size="28" font-family="Arial, 'Noto Sans SC', sans-serif">${line}</text>`).join("\n  ")}
  <text x="72" y="1046" fill="#D8B76A" font-size="26" font-family="Arial, 'Noto Sans SC', sans-serif" font-weight="700">OFFICE LEASING / SHANGHAI</text>
  <text x="72" y="1110" fill="#FFFFFF" font-size="48" font-family="Arial, 'Noto Sans SC', sans-serif" font-weight="900">${building}</text>
  <text x="72" y="1156" fill="#E1E7E4" font-size="30" font-family="Arial, 'Noto Sans SC', sans-serif">${subtitle}</text>
  <line x1="72" y1="1196" x2="1008" y2="1196" stroke="#FFFFFF" stroke-opacity="0.35"/>
  <text x="72" y="1250" fill="#FFFFFF" font-size="29" font-family="Arial, 'Noto Sans SC', sans-serif">01  ${points[0]}</text>
  <text x="72" y="1300" fill="#FFFFFF" font-size="29" font-family="Arial, 'Noto Sans SC', sans-serif">02  ${points[1]}</text>
  <text x="72" y="1350" fill="#FFFFFF" font-size="29" font-family="Arial, 'Noto Sans SC', sans-serif">03  ${points[2]}</text>
  <rect x="822" y="1216" width="164" height="164" fill="#FFFFFF"/>
  <path d="M844 1238h28v28h-28zM934 1238h28v28h-28zM844 1328h28v28h-28zM887 1282h16v16h-16zM916 1307h21v14h-21zM902 1284h18v20h-18z" fill="#10191D"/>
  <text x="72" y="1410" fill="#E6E9E5" font-size="27" font-family="Arial, 'Noto Sans SC', sans-serif">${contact}</text>
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

function wrapCjk(value, maxChars) {
  const chars = [...String(value)];
  const lines = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(""));
  }
  return lines.length ? lines : [""];
}

async function fetchDailyHotSource(url, source) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const data = Array.isArray(json.data) ? json.data : [];
  if (!data.length) throw new Error("empty data");
  return data.map((item, index) => normalizeRawTrend({
    title: item.title ?? item.word ?? item.name,
    desc: item.desc ?? item.description ?? "",
    url: item.url ?? item.mobileUrl ?? null,
    hotScore: item.hot ?? item.hotScore ?? item.index ?? 100 - index,
    source,
    index
  }));
}

async function fetchBaiduHotPage() {
  const response = await fetch("https://top.baidu.com/board?tab=realtime", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/<!--s-data:(.*?)-->/s);
  if (!match) throw new Error("Baidu embedded data not found");
  const payload = JSON.parse(match[1]);
  const content = payload?.data?.cards?.find((card) => Array.isArray(card.content))?.content ?? [];
  if (!content.length) throw new Error("Baidu hot list empty");
  return content.map((item, index) => normalizeRawTrend({
    title: item.word ?? item.query,
    desc: item.desc ?? "",
    url: item.url ?? item.rawUrl ?? null,
    hotScore: Number(item.hotScore) || 100 - index,
    source: "baidu:hot-page",
    index
  }));
}

function normalizeRawTrend(raw) {
  const category = classifyTrend(raw.title, raw.desc);
  const risk = riskScore(raw.title, raw.desc);
  const heat = normalizeHeat(raw.hotScore, raw.index);
  return {
    id: `trend_${crypto.createHash("md5").update(`${raw.source}:${raw.title}`).digest("hex").slice(0, 8)}`,
    title: raw.title,
    source: raw.source,
    category,
    url: raw.url,
    captured_at: new Date().toISOString(),
    summary: raw.desc ? raw.desc.slice(0, 120) : "",
    scores: {
      heat,
      timeliness: 90,
      marketing_potential: category === "sports" ? 88 : category === "city" ? 82 : 72,
      risk
    },
    risk_level: risk >= 70 ? "high" : risk >= 40 ? "medium" : "low"
  };
}

function normalizeProvidedTrend(item, index) {
  if (item?.scores) {
    return {
      ...item,
      id: item.id ?? `trend_${crypto.createHash("md5").update(`${item.source ?? "request"}:${item.title}`).digest("hex").slice(0, 8)}`,
      category: item.category ?? classifyTrend(item.title, item.summary),
      captured_at: item.captured_at ?? new Date().toISOString(),
      risk_level: item.risk_level ?? (item.scores.risk >= 70 ? "high" : item.scores.risk >= 40 ? "medium" : "low")
    };
  }
  return normalizeRawTrend({
    title: item.title,
    desc: item.summary ?? item.desc ?? "",
    url: item.url ?? null,
    hotScore: item.hot ?? item.hotScore ?? 100 - index,
    source: item.source ?? "request",
    index
  });
}

function applyTrendScope(trends, request) {
  const filteredByCategory = request.trend_scope?.categories?.length
    ? trends.filter((trend) => request.trend_scope.categories.includes(trend.category))
    : trends;
  const scoped = filteredByCategory.length ? filteredByCategory : trends;
  return filterMarketingSafeTrends(scoped).slice(0, request.trend_scope?.limit ?? 30);
}

function dedupeTrends(trends) {
  const unique = new Map();
  trends.forEach((trend) => {
    const key = trend.title.replaceAll(/\s/g, "").toLowerCase();
    const current = unique.get(key);
    if (!current || trend.scores.heat > current.scores.heat) unique.set(key, trend);
  });
  return [...unique.values()];
}

function filterMarketingSafeTrends(trends) {
  const safe = trends.filter((trend) => trend.risk_level !== "high");
  const preferred = safe.filter((trend) => ["sports", "city", "business", "weather", "lifestyle"].includes(trend.category));
  return (preferred.length ? preferred : safe).sort((a, b) => {
    const categoryBoost = (trend) => trend.category === "sports" ? 25 : trend.category === "city" ? 18 : trend.category === "business" ? 12 : 0;
    const aScore = a.scores.heat + a.scores.marketing_potential + categoryBoost(a) - a.scores.risk;
    const bScore = b.scores.heat + b.scores.marketing_potential + categoryBoost(b) - b.scores.risk;
    return bScore - aScore;
  });
}

function classifyTrend(title = "", desc = "") {
  const text = `${title} ${desc}`;
  if (/世界杯|足球|法国队|姆巴佩|登贝莱|夺冠|强队|比赛|NBA|欧冠/.test(text)) return "sports";
  if (/台风|降雨|高温|天气|通勤/.test(text)) return "weather";
  if (/车位|商圈|地铁|城市|消费|停车|业主|物业/.test(text)) return "city";
  if (/企业|商业|出口|经济|公司|微信/.test(text)) return "business";
  if (/结婚|生活|餐饮|禁烟|门店/.test(text)) return "lifestyle";
  return "other";
}

function riskScore(title = "", desc = "") {
  const text = `${title} ${desc}`;
  if (/总书记|外交部|南海|仲裁|政治|地震|救灾|洪水|溃坝|死亡|白骨|癌|火灾|诈骗|剧毒|灾后|禁运/.test(text)) return 85;
  if (/台风|降雨|撤离|报警|处罚|纠纷/.test(text)) return 45;
  if (/微信回应|车位|禁烟/.test(text)) return 25;
  return 12;
}

function normalizeHeat(score, index) {
  const numeric = Number(score);
  if (Number.isFinite(numeric) && numeric > 1000) return Math.max(50, Math.min(100, Math.round(numeric / 100000)));
  if (Number.isFinite(numeric)) return Math.max(50, Math.min(100, Math.round(numeric)));
  return Math.max(50, 95 - index);
}

function extractDocumentFacts(content) {
  const rules = {
    name: ["楼宇名称", "项目名称", "项目", "名称"],
    brand: ["品牌", "品牌名称"],
    city: ["城市"],
    business_area: ["商圈", "商务区", "所在商圈"],
    address: ["地址", "项目地址"],
    metro: ["地铁", "交通", "轨交"],
    rent_price: ["租金", "租赁价格", "报价"],
    area_range: ["可租面积", "面积", "面积范围"],
    contact: ["联系人", "联系方式", "咨询电话"],
    cta: ["行动号召", "CTA"]
  };
  return Object.fromEntries(Object.entries(rules).map(([field, labels]) => [field, extractLabelValue(content, labels)]));
}

function extractLabelValue(content, labels) {
  for (const label of labels) {
    const match = String(content).match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${label}\\s*[：:]\\s*([^\\n|]+)`, "m"));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractListFact(content, labels) {
  const value = extractLabelValue(content, labels);
  if (!value) return [];
  return value
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function traceStep(skill, action, input, output) {
  return {
    skill,
    action,
    input,
    output_summary: summarizeOutput(output),
    output
  };
}

function summarizeOutput(output) {
  if (Array.isArray(output)) return `${output.length} items`;
  if (output?.trends) return `${output.trends.length} trends, sources=${output.diagnostics?.sources_used?.join(",")}`;
  if (output?.topic_candidates) return `${output.topic_candidates.length} topic candidates`;
  if (output?.selectedTopic) return `selected=${output.selectedTopic.angle}`;
  if (output?.publish_records) return `${output.publish_records.length} publish records`;
  if (output?.creative_id) return `creative=${output.creative_id}`;
  if (typeof output === "object" && output) return Object.keys(output).slice(0, 6).join(", ");
  return String(output);
}
