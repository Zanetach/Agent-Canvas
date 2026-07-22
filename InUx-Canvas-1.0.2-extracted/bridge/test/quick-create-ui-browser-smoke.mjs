import assert from "node:assert/strict";

const debugBase = process.argv[2];
assert.ok(debugBase, "missing Chrome DevTools endpoint");

const pages = await fetch(`${debugBase}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page");
assert.ok(page?.webSocketDebuggerUrl, "BeeMax page was not available in Chrome");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || "browser evaluation failed");
  }
  return response.result?.result?.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await evaluate(`document.querySelector('.back-button')?.click()`);
  await wait(400);

  const initial = JSON.parse(
    await evaluate(`JSON.stringify({
      visible: Boolean(document.querySelector('.quick-create-panel')),
      simpleActions: Boolean(document.querySelector('.quick-create-simple-actions')),
      simpleHint: document.querySelector('.quick-create-simple-hint')?.innerText || '',
      moreSettingsOpen: document.querySelector('.quick-create-more-settings')?.open || false,
      tabs: [...document.querySelectorAll('.quick-create-type-tab')].map((element) => element.innerText),
      exampleCount: document.querySelectorAll('.quick-create-example').length,
      modes: [...document.querySelectorAll('.quick-create-mode')].map((element) => element.textContent.trim()),
      promptPlaceholder: document.querySelector('.quick-create-prompt')?.placeholder || ''
    })`),
  );
  assert.equal(initial.visible, true);
  assert.equal(initial.simpleActions, true);
  assert.match(initial.simpleHint, /直接文字生成/);
  assert.equal(initial.moreSettingsOpen, false);
  assert.deepEqual(initial.tabs, ["图片", "视频"]);
  assert.equal(initial.exampleCount, 3);
  assert.deepEqual(initial.modes, [
    "直接生成",
    "参考图生成",
    "图片编辑",
    "局部重绘",
    "扩图",
    "生成变体",
  ]);
  assert.match(initial.promptPlaceholder, /简单描述你想要的图片/);

  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 16;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'reference.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('input[type="file"][multiple]');
    Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(300);
  assert.match(
    await evaluate(`document.querySelector('.quick-create-simple-hint')?.innerText || ''`),
    /参考图生成 · 9:16/,
  );
  await evaluate(`document.querySelector('.quick-create-asset button')?.click()`);
  await wait(100);
  assert.match(
    await evaluate(`document.querySelector('.quick-create-simple-hint')?.innerText || ''`),
    /直接文字生成/,
  );

  await command("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(100);
  assert.equal(
    await evaluate(`(() => {
      const panel = document.querySelector('.quick-create-panel')?.getBoundingClientRect();
      return Boolean(panel && panel.left >= 0 && panel.right <= 375 && document.documentElement.scrollWidth <= 375);
    })()`),
    true,
    "simple creator should fit a 375px viewport without horizontal overflow",
  );
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(100);

  await evaluate(`document.querySelector('.quick-create-more-settings > summary')?.click()`);
  await wait(50);
  const videoCapability = JSON.parse(
    await evaluate(`JSON.stringify({
      alert: Boolean(document.querySelector('.quick-create-capability-alert')),
      model: document.querySelector('[aria-label="生成模型"]')?.value || '',
      disabled: document.querySelector('.quick-create-submit')?.disabled || false
    })`),
  );
  if (!videoCapability.model) {
    assert.equal(videoCapability.alert, true, "unconfigured video generation should be blocked before submit");
    assert.equal(videoCapability.disabled, true);
  }
  assert.equal(
    await evaluate(`document.querySelector('.quick-create-more-settings')?.open || false`),
    true,
  );
  assert.deepEqual(
    JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('.quick-create-mode-section-title')].map((node) => node.textContent.trim()))`),
    ),
    ["快捷素材", "生成方式", "图片处理"],
  );
  assert.match(
    await evaluate(`document.querySelector('.quick-create-template-card')?.innerText || ''`),
    /商业海报/,
  );
  assert.match(
    await evaluate(`document.querySelector('.quick-create-mode-guide')?.innerText || ''`),
    /当前模式：直接生成/,
  );
  assert.deepEqual(
    JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('.quick-create-controls > label > span')].map((node) => node.textContent.trim()))`),
    ),
    ["AI 服务", "生成模型", "生成数量", "画面比例", "分辨率"],
  );

  await evaluate(
    `document.querySelector('.quick-create-template-card')?.click()`,
  );
  await wait(100);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-poster-overlay'))`), true);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal[role="dialog"][aria-modal="true"]'))`), true);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-composer .poster-template-panel'))`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-assets'))`), false);
  assert.equal(
    await evaluate(`document.querySelectorAll('.quick-create-poster-modal .poster-template-fields input, .quick-create-poster-modal .poster-template-fields textarea').length`),
    10,
  );

  await evaluate(`(() => {
    const field = document.querySelector('.quick-create-poster-modal .poster-template-brief');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '为科技品牌制作一张蓝色产品发布海报');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('.quick-create-poster-modal .poster-template-apply')?.click()`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(100);
    if (!(await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal'))`))) break;
  }
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal'))`), false);
  assert.match(
    await evaluate(`document.querySelector('.quick-create-prompt')?.value || ''`),
    /科技品牌.*蓝色产品发布海报/,
    "applying a commercial poster should backfill the homepage prompt and close the modal",
  );

  await evaluate(`document.querySelector('.quick-create-template-card')?.click()`);
  await wait(100);
  await evaluate(`document.querySelector('[aria-label="关闭商业海报弹窗"]')?.click()`);
  await wait(100);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal'))`), false);

  await evaluate(`document.querySelector('.quick-create-template-card')?.click()`);
  await wait(100);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(100);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal'))`), false);

  await evaluate(
    `[...document.querySelectorAll('.quick-create-mode')].find((button) => button.innerText === '直接生成')?.click()`,
  );
  await evaluate(`(() => {
    const field = document.querySelector('.quick-create-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('.quick-create-submit')?.click()`);
  await wait(100);
  assert.match(await evaluate(`document.querySelector('.quick-create-message')?.innerText || ''`), /请输入生成内容/);

  await evaluate(
    `[...document.querySelectorAll('.quick-create-type-tab')].find((button) => button.innerText === '视频')?.click()`,
  );
  await wait(50);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('[aria-label="视频时长"]'))`),
    true,
  );
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="分辨率"]')?.value`),
    "720p",
  );
  await evaluate(`(() => {
    const target = document.querySelector('.quick-create-capability-alert > button') ||
      document.querySelector('[aria-label="设置"]');
    target?.click();
  })()`);
  await wait(150);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.managed-provider-panel'))`),
    true,
    "managed BeeMax provider should render a read-only summary",
  );
  assert.match(
    await evaluate(`document.querySelector('.managed-provider-panel')?.innerText || ''`),
    /新增视频配置/,
  );
  await evaluate(`document.querySelector('[aria-label="项目首页"]')?.click()`);
  await wait(150);
  await evaluate(`document.querySelector('[aria-label="模板库"]')?.click()`);
  await wait(150);
  assert.equal(
    await evaluate(`document.querySelectorAll('.starter-template-card').length`),
    4,
    "empty template library should offer starter templates",
  );
  await evaluate(`document.querySelector('.starter-template-card')?.click()`);
  await wait(150);
  assert.match(
    await evaluate(`document.querySelector('.quick-create-prompt')?.value || ''`),
    /产品发布海报/,
    "starter template should return to the homepage with a useful draft",
  );
  await evaluate(`(() => {
    const field = document.querySelector('.quick-create-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(
    `[...document.querySelectorAll('.quick-create-type-tab')].find((button) => button.innerText === '图片')?.click()`,
  );
  await wait(50);
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="分辨率"]')?.value`),
    "1k",
  );

  await evaluate(`(() => {
    const field = document.querySelector('.quick-create-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '科技蓝机械蜜蜂悬浮在精密电路城市上空');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  await evaluate(`document.querySelector('.quick-create-more-settings > summary')?.click()`);
  await wait(50);
  await evaluate(
    `[...document.querySelectorAll('.quick-create-mode')].find((button) => button.innerText === '参考图生成')?.click()`,
  );
  await wait(50);
  const imageCapabilityAfterStarter = await evaluate(`JSON.stringify({
    disabled: document.querySelector('.quick-create-submit')?.disabled,
    provider: document.querySelector('[aria-label="AI Provider"]')?.value || '',
    model: document.querySelector('[aria-label="生成模型"]')?.value || '',
    mode: [...document.querySelectorAll('.quick-create-mode')].find((button) => button.classList.contains('active'))?.innerText || '',
    prompt: document.querySelector('.quick-create-prompt')?.value || ''
  })`);
  assert.equal(
    JSON.parse(imageCapabilityAfterStarter).disabled,
    false,
    `image generation should remain configured after using a starter template: ${imageCapabilityAfterStarter}`,
  );
  await evaluate(`document.querySelector('.quick-create-submit')?.click()`);
  await wait(100);
  assert.match(
    await evaluate(`document.querySelector('.quick-create-message')?.innerText || ''`),
    /需要先上传至少一张源图片/,
  );
  await evaluate(
    `[...document.querySelectorAll('.quick-create-mode')].find((button) => button.innerText === '直接生成')?.click()`,
  );
  await evaluate(`document.querySelector('.quick-create-submit')?.click()`);

  let canvasReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await wait(100);
    canvasReady = await evaluate(`Boolean(document.querySelector('.canvas-flow-shell'))`);
    if (canvasReady) break;
  }
  assert.equal(canvasReady, true, "quick create did not open a Canvas project");
  assert.equal(
    await evaluate(`document.querySelectorAll('.result-node').length`),
    1,
    "homepage quick create should not add the blank assistant node pair",
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-image-assistant'))`),
    true,
    "unified image creator should be visible",
  );
  assert.equal(await evaluate(`document.querySelectorAll('.canvas-image-assistant-step-title').length`), 0);
  assert.equal(await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-professional'))`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-form'))`), true);
  await wait(50);
  assert.match(
    await evaluate(`document.querySelector('.canvas-image-assistant-prompt')?.value || ''`),
    /科技蓝机械蜜蜂/,
    "the homepage prompt should carry into the unified Canvas creator",
  );
  assert.notEqual(
    await evaluate(`document.querySelector('.canvas-image-assistant-header h2')?.textContent.trim()`),
    "创建你的图片",
    "an auto-running homepage request should not look like a fresh empty workflow",
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-composer-dock'))`),
    false,
    "node editor should stay hidden until a result is selected",
  );
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-progress')?.textContent.trim()`),
    "图片创作",
  );
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-generate')?.disabled`),
    true,
    "the unified creator should prevent duplicate submission while homepage generation is running",
  );
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-generate')?.textContent.trim()`),
    "正在生成…",
  );

  let generated = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(100);
    generated = await evaluate(`Boolean(document.querySelector('.result-image-node img'))`);
    if (generated) break;
  }
  assert.equal(generated, true, "quick create did not automatically run image generation");
  assert.match(await evaluate(`document.querySelector('.canvas-title-input')?.value || ''`), /科技蓝机械蜜蜂/);
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-progress')?.textContent.trim()`),
    "图片创作",
  );
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-header h2')?.textContent.trim()`),
    "继续创作",
  );

  await evaluate(`(() => {
    const field = document.querySelector('.canvas-image-assistant-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-prompt')?.value`),
    "",
    "users should be able to clear the injected homepage prompt",
  );

  const imageCountBeforeTextOnly = await evaluate(
    `document.querySelectorAll('.result-image-node img').length`,
  );
  await evaluate(`(() => {
    const field = document.querySelector('.canvas-image-assistant-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '一只蓝色机械蜜蜂飞过未来城市');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-progress')?.textContent.trim()`),
    "图片创作",
  );
  await evaluate(`document.querySelector('.canvas-image-assistant-generate')?.click()`);
  let textOnlyGenerated = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(100);
    textOnlyGenerated =
      (await evaluate(`document.querySelectorAll('.result-image-node img').length`)) >=
      imageCountBeforeTextOnly + 1;
    if (textOnlyGenerated) break;
  }
  assert.equal(textOnlyGenerated, true, "assistant should generate without a reference image");

  const imageCountBeforeAssistant = await evaluate(
    `document.querySelectorAll('.result-image-node img').length`,
  );
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 4;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'assistant-reference.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const dropZone = document.querySelector('.canvas-image-assistant-upload');
    dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(100);
    if (await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-upload.has-image img'))`)) break;
  }
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-upload.has-image img'))`),
    true,
    "assistant reference image upload did not complete",
  );
  await evaluate(`(() => {
    const field = document.querySelector('.canvas-image-assistant-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '保持构图，改成科技蓝机械蜜蜂海报');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-progress')?.textContent.trim()`),
    "图片创作",
  );
  await evaluate(`document.querySelector('.canvas-image-assistant-generate')?.click()`);
  let assistantGenerated = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(100);
    assistantGenerated =
      (await evaluate(`document.querySelectorAll('.result-image-node img').length`)) >=
      imageCountBeforeAssistant + 2;
    if (assistantGenerated) break;
  }
  assert.equal(assistantGenerated, true, "assistant did not generate from the uploaded reference image");

  const visibleResultCountBeforeClear = await evaluate(`document.querySelectorAll('.result-node').length`);
  await evaluate(`document.querySelector('.canvas-image-assistant-clear-reference')?.click()`);
  await wait(100);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-upload.has-image'))`),
    false,
    "removing the optional reference should restore the text-to-image upload state",
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.result-node').length`),
    visibleResultCountBeforeClear - 1,
    "removing the optional reference should remove its Canvas source node",
  );

  await evaluate(`(() => {
    const result = [...document.querySelectorAll('.result-node')]
      .find((node) => node.textContent.includes('生成图片'))
      ?.closest('.react-flow__node');
    result?.click();
  })()`);
  let advancedModeReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(100);
    advancedModeReady = await evaluate(
      `Boolean(document.querySelector('.canvas-composer-dock')) && Boolean(document.querySelector('.canvas-image-assistant')?.hidden)`,
    );
    if (advancedModeReady) break;
  }
  assert.equal(advancedModeReady, true, "selecting a result should open its node editor");
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-composer-dock .image-composer-mode-switch'))`),
    false,
    "the node editor should not reintroduce simple and professional modes",
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-composer-dock .image-creation-fields'))`),
    true,
    "the single node editor should retain image prompt controls",
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-composer-dock .image-composer-poster-material'))`),
    true,
    "commercial poster generation should remain available as an optional material",
  );

  await evaluate(`document.querySelector('.canvas-composer-dock .canvas-overlay-close-btn')?.click()`);
  let unifiedCreatorRestored = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(100);
    unifiedCreatorRestored = await evaluate(
      `!document.querySelector('.canvas-composer-dock') && !document.querySelector('.canvas-image-assistant')?.hidden`,
    );
    if (unifiedCreatorRestored) break;
  }
  assert.equal(unifiedCreatorRestored, true, "closing the node editor should restore the unified image creator");
  assert.equal(
    await evaluate(`document.querySelectorAll('.react-flow__node.selected').length`),
    0,
    "closing the compact advanced composer should clear the active node selection",
  );

  await evaluate(`document.querySelector('.back-button')?.click()`);
  await wait(300);
  await evaluate(`document.querySelector('.new-project-card')?.click()`);
  let emptyCanvasReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(100);
    emptyCanvasReady = await evaluate(
      `Boolean(document.querySelector('.canvas-flow-shell')) && document.querySelectorAll('.result-node').length === 0`,
    );
    if (emptyCanvasReady) break;
  }
  assert.equal(emptyCanvasReady, true, "new blank Canvas should not precreate image nodes");
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-form'))`),
    true,
    "the same unified creator should work on an empty Canvas",
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-image-assistant-professional'))`),
    false,
    "the unified creator should not expose a professional-mode switch",
  );
  await evaluate(`(() => {
    const select = document.querySelector('.canvas-image-assistant-settings [aria-label="图片数量"]');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    descriptor.set.call(select, '2');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.result-node').length`),
    0,
    "changing unified generation settings should not create placeholder nodes",
  );
} finally {
  socket.close();
}

console.log("PASS full homepage quick-create interaction");
