import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runMarketingCampaignLive } from "../src/marketingAgent.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(root, "outputs");

const request = {
  scenario: "building_leasing",
  marketing_goal: "lead_generation",
  target_channels: ["xiaohongshu", "wechat_official_account", "moments"],
  trend_scope: {
    city: "Shanghai",
    categories: ["sports", "city", "weather"],
    limit: 30
  }
};

const result = await runMarketingCampaignLive(request);
const runDir = path.join(outputRoot, result.run_id);
await fs.mkdir(runDir, { recursive: true });

const creative = result.creatives[0];
const copy = result.copies.channels;

await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2));
await fs.writeFile(path.join(runDir, "pipeline-report.md"), buildPipelineReport(result));
await fs.writeFile(path.join(runDir, "poster.svg"), creative.preview_svg);
await fs.writeFile(path.join(runDir, "poster-editable.json"), JSON.stringify(creative.design_json, null, 2));
await fs.writeFile(path.join(runDir, "publish-packages.json"), JSON.stringify(result.publish_packages, null, 2));
await fs.writeFile(
  path.join(runDir, "copy.md"),
  [
    "# 营销内容 Agent 跑通结果",
    "",
    `Run ID: ${result.run_id}`,
    "",
    "## 推荐选题",
    "",
    result.selected_topic.angle,
    "",
    "## 小红书",
    "",
    `标题：${copy.xiaohongshu.titles[0]}`,
    "",
    copy.xiaohongshu.body,
    "",
    `标签：${copy.xiaohongshu.hashtags.map((tag) => `#${tag}`).join(" ")}`,
    "",
    "## 公众号",
    "",
    `标题：${copy.wechat_official_account.title}`,
    "",
    copy.wechat_official_account.body_markdown,
    "",
    "## 朋友圈",
    "",
    copy.moments.text,
    "",
    "## 销售转发话术",
    "",
    ...copy.moments.sales_variants.map((item, index) => `${index + 1}. ${item}`)
  ].join("\n")
);

const posterPng = path.join(runDir, "poster.png");
await tryCreatePng(path.join(runDir, "poster.svg"), posterPng);

console.log(JSON.stringify({
  run_id: result.run_id,
  selected_topic: result.selected_topic.angle,
  files: {
    result_json: path.join(runDir, "result.json"),
    pipeline_report: path.join(runDir, "pipeline-report.md"),
    copy_md: path.join(runDir, "copy.md"),
    poster_svg: path.join(runDir, "poster.svg"),
    poster_png: posterPng,
    poster_editable_json: path.join(runDir, "poster-editable.json"),
    publish_packages: path.join(runDir, "publish-packages.json")
  }
}, null, 2));

async function tryCreatePng(svgPath, pngPath) {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try {
    await execFileAsync(chromePath, [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1080,1440",
      `--screenshot=${pngPath}`,
      `file://${svgPath}`
    ]);
  } catch (error) {
    console.warn(`PNG export skipped: ${error.message}`);
  }
}

function buildPipelineReport(result) {
  const lines = [
    "# 营销内容 Agent 流程跑通报告",
    "",
    `Run ID: ${result.run_id}`,
    `Created At: ${result.created_at}`,
    `Scenario: ${result.scenario}`,
    "",
    "## 最终选择",
    "",
    `- 选题：${result.selected_topic.angle}`,
    `- 热点：${result.selected_topic.trend_title}`,
    `- 分数：${result.selected_topic.scores.total}`,
    `- 下一步：${result.next_required_action}`,
    "",
    "## 路径明细"
  ];

  result.trace.forEach((step, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${step.skill}`,
      "",
      `做了什么：${step.action}`,
      "",
      `输出摘要：${step.output_summary}`,
      "",
      "输入：",
      "",
      "```json",
      JSON.stringify(trimForReport(step.input), null, 2),
      "```",
      "",
      "关键输出：",
      "",
      "```json",
      JSON.stringify(trimForReport(step.output), null, 2),
      "```"
    );
  });

  lines.push(
    "",
    "## 产物",
    "",
    "- `copy.md`：小红书、公众号、朋友圈、销售转发话术",
    "- `poster.png`：1080x1440 海报 PNG",
    "- `poster-editable.json`：可编辑海报图层 JSON",
    "- `publish-packages.json`：公众号/小红书/朋友圈发布包",
    "- `result.json`：完整机器可读结果"
  );

  return lines.join("\n");
}

function trimForReport(value) {
  if (Array.isArray(value)) return value.slice(0, 5).map(trimForReport);
  if (!value || typeof value !== "object") return value;
  if (value.preview_svg) return { ...value, preview_svg: "[svg omitted]" };
  if (value.output && typeof value.output === "object") return trimForReport(value.output);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) return [key, item.slice(0, 5).map(trimForReport)];
      if (typeof item === "string" && item.length > 500) return [key, `${item.slice(0, 500)}...`];
      return [key, item && typeof item === "object" ? trimForReport(item) : item];
    })
  );
}
