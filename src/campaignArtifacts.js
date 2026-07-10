import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function writeCampaignArtifacts({ result, outputRoot, heroAssetPath }) {
  const runDir = path.join(outputRoot, result.run_id);
  await fs.mkdir(runDir, { recursive: true });

  const creative = result.creatives[0];
  const heroAssetRef = path.basename(creative.design_json.layers.find((layer) => layer.id === "hero")?.asset_ref ?? "");
  if (heroAssetRef && heroAssetPath) await fs.copyFile(heroAssetPath, path.join(runDir, heroAssetRef));

  const posterSvg = path.join(runDir, "poster.svg");
  const posterPng = path.join(runDir, "poster.png");
  await fs.writeFile(posterSvg, creative.preview_svg);
  const pngCreated = await createPng(posterSvg, posterPng);

  const delivery = buildDeliveryPackages(result, pngCreated ? "poster.png" : "poster.svg");
  await Promise.all([
    fs.writeFile(path.join(runDir, "poster-editable.json"), JSON.stringify(creative.design_json, null, 2)),
    fs.writeFile(path.join(runDir, "wechat-draft.json"), JSON.stringify(delivery.wechat_draft, null, 2)),
    fs.writeFile(path.join(runDir, "publish-packages.json"), JSON.stringify(result.publish_packages, null, 2)),
    fs.writeFile(path.join(runDir, "xiaohongshu-package.md"), delivery.xiaohongshu_markdown),
    fs.writeFile(path.join(runDir, "moments-package.txt"), delivery.moments_text),
    fs.writeFile(path.join(runDir, "copy.md"), buildCopyDocument(result)),
    fs.writeFile(path.join(runDir, "pipeline-report.md"), buildPipelineReport(result))
  ]);

  const artifacts = {
    run_dir: runDir,
    result_json: "result.json",
    pipeline_report: "pipeline-report.md",
    copy: "copy.md",
    poster_png: pngCreated ? "poster.png" : null,
    poster_svg: "poster.svg",
    poster_editable_json: "poster-editable.json",
    wechat_draft: "wechat-draft.json",
    xiaohongshu_package: "xiaohongshu-package.md",
    moments_package: "moments-package.txt",
    publish_packages: "publish-packages.json"
  };
  await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify({ ...result, artifacts }, null, 2));
  return artifacts;
}

export function buildDeliveryPackages(result, posterFile) {
  const { xiaohongshu, wechat_official_account: wechat, moments } = result.copies.channels;
  return {
    wechat_draft: {
      status: "ready_to_create_draft",
      title: wechat.title,
      digest: wechat.digest,
      author: result.knowledge_summary.brand_profile.name,
      content_markdown: wechat.body_markdown,
      cover_asset: posterFile,
      review_required: true
    },
    xiaohongshu_markdown: [
      `# ${xiaohongshu.titles[0]}`,
      "",
      xiaohongshu.body,
      "",
      xiaohongshu.hashtags.map((tag) => `#${tag}`).join(" "),
      "",
      `配图：${posterFile}`,
      "发布前检查：标题、话题、楼宇事实、联系方式和二维码。"
    ].join("\n"),
    moments_text: [moments.text, "", "销售转发话术：", ...moments.sales_variants.map((item, index) => `${index + 1}. ${item}`)].join("\n")
  };
}

async function createPng(svgPath, pngPath) {
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
    return true;
  } catch {
    return false;
  }
}

function buildCopyDocument(result) {
  const copy = result.copies.channels;
  return [
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
    copy.wechat_official_account.body_markdown,
    "",
    "## 朋友圈",
    "",
    copy.moments.text
  ].join("\n");
}

function buildPipelineReport(result) {
  const selectedTrend = result.trends.find((trend) => trend.id === result.selected_topic.trend_id);
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
    `- 热点来源：${selectedTrend?.source ?? "unknown"}`,
    `- 原始链接：${selectedTrend?.url ?? "未提供"}`,
    `- 分数：${result.selected_topic.scores.total}`,
    "",
    "## 知识库引用",
    "",
    ...(result.knowledge_summary.source_refs?.map((source) => `- ${source.name}`) ?? ["- 使用默认演示知识库"]),
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
  return lines.join("\n");
}

function trimForReport(value) {
  if (Array.isArray(value)) return value.slice(0, 5).map(trimForReport);
  if (!value || typeof value !== "object") return value;
  if (value.preview_svg) return { ...value, preview_svg: "[svg omitted]" };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) return [key, item.slice(0, 5).map(trimForReport)];
      if (typeof item === "string" && item.length > 500) return [key, `${item.slice(0, 500)}...`];
      return [key, item && typeof item === "object" ? trimForReport(item) : item];
    })
  );
}
