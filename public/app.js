const runButton = document.querySelector("#runButton");
const statusEl = document.querySelector("#status");
const runIdEl = document.querySelector("#runId");
const stagesEl = document.querySelector("#stages");
const topicEl = document.querySelector("#topic");
const copyOutput = document.querySelector("#copyOutput");
const posterPreview = document.querySelector("#posterPreview");
const packagesEl = document.querySelector("#packages");
const jsonOutput = document.querySelector("#jsonOutput");
const tabs = [...document.querySelectorAll(".tab")];

let lastResult = null;
let activeCopy = "xiaohongshu";

runButton.addEventListener("click", async () => {
  setStatus("运行中：正在调用营销 Agent 流程");
  runButton.disabled = true;
  markStages(false);

  try {
    const payload = {
      scenario: document.querySelector("#scenario").value,
      marketing_goal: document.querySelector("#goal").value,
      target_channels: ["xiaohongshu", "wechat_official_account", "moments"],
      trend_scope: {
        city: "Shanghai",
        categories: ["sports", "city", "weather"],
        limit: 30
      }
    };

    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    lastResult = await response.json();
    renderResult(lastResult);
    setStatus("已完成：等待人工审核后发布/导出");
  } catch (error) {
    setStatus(`运行失败：${error.message}`);
  } finally {
    runButton.disabled = false;
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeCopy = tab.dataset.copy;
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    renderCopy();
  });
});

function renderResult(result) {
  runIdEl.textContent = result.run_id;
  markStages(true);
  renderTopic(result.selected_topic);
  renderCopy();
  posterPreview.innerHTML = result.creatives[0].preview_svg;
  renderPackages(result.publish_packages);
  jsonOutput.textContent = JSON.stringify(result, null, 2);
}

function renderTopic(topic) {
  topicEl.classList.remove("empty");
  topicEl.innerHTML = `
    <strong>${escapeHtml(topic.angle)}</strong>
    <span>趋势：${escapeHtml(topic.trend_title)}</span>
    <span>总分：${topic.scores.total}｜风险：${topic.scores.risk}</span>
    <span>${escapeHtml(topic.reasoning)}</span>
  `;
}

function renderCopy() {
  if (!lastResult) return;
  const channel = lastResult.copies.channels[activeCopy];
  copyOutput.textContent = JSON.stringify(channel, null, 2);
}

function renderPackages(records) {
  packagesEl.classList.remove("empty");
  packagesEl.innerHTML = records
    .map(
      (record) => `
        <div class="package">
          <div class="package-title">${escapeHtml(record.channel)}｜${escapeHtml(record.mode)}</div>
          <div>状态：${escapeHtml(record.status)}</div>
          <div>下一步：${escapeHtml(record.next_action ?? "可导出给运营发布")}</div>
        </div>
      `
    )
    .join("");
}

function markStages(done) {
  [...stagesEl.children].forEach((item) => item.classList.toggle("done", done));
}

function setStatus(message) {
  statusEl.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
