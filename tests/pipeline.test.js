import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeBaseFromDocuments, runMarketingCampaign } from "../src/marketingAgent.js";

test("runs the full marketing agent pipeline", () => {
  const result = runMarketingCampaign({
    scenario: "building_leasing",
    marketing_goal: "lead_generation",
    target_channels: ["xiaohongshu", "wechat_official_account", "moments"],
    trend_scope: {
      categories: ["sports", "city", "weather"],
      limit: 30
    }
  });

  assert.equal(result.scenario, "building_leasing");
  assert.ok(result.marketing_brief.primary_goal);
  assert.ok(result.audiences.length >= 2);
  assert.ok(result.trends.length >= 1);
  assert.ok(result.topic_candidates.length >= 1);
  assert.ok(result.copies.channels.xiaohongshu.body.includes("绿洲中心"));
  assert.ok(result.creatives[0].design_json.layers.some((layer) => layer.id === "qrcode"));
  assert.equal(result.creatives[0].design_json.layers.find((layer) => layer.id === "hero").type, "image");
  assert.ok(result.creatives[0].preview_svg.includes("<svg"));
  assert.ok(result.publish_packages.some((record) => record.channel === "xiaohongshu"));
  assert.equal(result.next_required_action, "review");
});

test("builds a marketing fact package from supplied knowledge documents", () => {
  const knowledgeBase = knowledgeBaseFromDocuments({
    scenario: "building_leasing",
    knowledge_documents: [
      {
        name: "绿洲中心招商资料.md",
        content: `楼宇名称：绿洲中心\n城市：上海\n商圈：南京西路\n地铁：2号线步行3分钟\n可租面积：200-2000㎡\n联系人：张顾问 138-0000-0000\n卖点：地铁近、24小时安保、大堂空间适合活动`
      }
    ]
  });

  const result = runMarketingCampaign({
    scenario: "building_leasing",
    knowledge_base: knowledgeBase,
    trend_items: [
      { title: "城市核心商圈夜间消费热度上升", source: "test:city", category: "city", hot: 90 }
    ]
  });

  assert.equal(knowledgeBase.entities[0].name, "绿洲中心");
  assert.equal(result.trends[0].source, "test:city");
  assert.equal(result.knowledge_summary.source_refs[0].name, "绿洲中心招商资料.md");
  assert.match(result.copies.channels.xiaohongshu.body, /南京西路/);
});
