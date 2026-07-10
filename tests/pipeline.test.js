import assert from "node:assert/strict";
import test from "node:test";
import { runMarketingCampaign } from "../src/marketingAgent.js";

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
  assert.ok(result.creatives[0].preview_svg.includes("<svg"));
  assert.ok(result.publish_packages.some((record) => record.channel === "xiaohongshu"));
  assert.equal(result.next_required_action, "review");
});
