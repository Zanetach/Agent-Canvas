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
      modes: [...document.querySelectorAll('.quick-create-mode')].map((element) => element.textContent.trim()),
      promptPlaceholder: document.querySelector('.quick-create-prompt')?.placeholder || ''
    })`),
  );
  assert.equal(initial.visible, true);
  assert.equal(initial.simpleActions, true);
  assert.match(initial.simpleHint, /直接文字生成/);
  assert.equal(initial.moreSettingsOpen, false);
  assert.deepEqual(initial.tabs, ["图片", "视频"]);
  assert.deepEqual(initial.modes, [
    "直接生成",
    "商业海报",
    "参考图生成",
    "图片编辑",
    "Mask 重绘",
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
  assert.equal(
    await evaluate(`document.querySelector('.quick-create-more-settings')?.open || false`),
    true,
  );

  await evaluate(
    `[...document.querySelectorAll('.quick-create-mode')].find((button) => button.innerText === '商业海报')?.click()`,
  );
  await wait(100);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-create-panel .poster-template-panel'))`), true);
  assert.equal(
    await evaluate(`document.querySelectorAll('.quick-create-panel .poster-template-fields input, .quick-create-panel .poster-template-fields textarea').length`),
    10,
  );

  await evaluate(
    `[...document.querySelectorAll('.quick-create-mode')].find((button) => button.innerText === '直接生成')?.click()`,
  );
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
  await evaluate(
    `[...document.querySelectorAll('.quick-create-mode')].find((button) => button.innerText === '参考图生成')?.click()`,
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
    "canvas image assistant should be visible",
  );
  assert.deepEqual(
    JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('.canvas-image-assistant-step-title')].map((node) => node.textContent.trim()))`),
    ),
    ["描述想生成的图片", "添加参考图（可选）", "开始生成"],
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.canvas-composer-dock'))`),
    false,
    "advanced node composer should stay hidden while the beginner assistant is active",
  );
  assert.equal(
    await evaluate(`document.querySelector('.canvas-image-assistant-progress')?.textContent.trim()`),
    "图片创作 · 第 1/3 步",
  );

  let generated = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(100);
    generated = await evaluate(`Boolean(document.querySelector('.result-image-node img'))`);
    if (generated) break;
  }
  assert.equal(generated, true, "quick create did not automatically run image generation");
  assert.match(await evaluate(`document.querySelector('.canvas-title-input')?.value || ''`), /科技蓝机械蜜蜂/);

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
    "图片创作 · 第 3/3 步",
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
    "图片创作 · 第 3/3 步",
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
  assert.equal(advancedModeReady, true, "selecting a result should switch from the beginner assistant to the advanced composer");

  const panePoint = JSON.parse(
    await evaluate(`(() => {
      const rect = document.querySelector('.react-flow__pane')?.getBoundingClientRect();
      return JSON.stringify({ x: rect ? rect.left + 24 : 24, y: rect ? rect.bottom - 24 : 824 });
    })()`),
  );
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: panePoint.x, y: panePoint.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: panePoint.x, y: panePoint.y, button: "left", clickCount: 1 });
  let beginnerModeRestored = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(100);
    beginnerModeRestored = await evaluate(
      `!document.querySelector('.canvas-composer-dock') && !document.querySelector('.canvas-image-assistant')?.hidden`,
    );
    if (beginnerModeRestored) break;
  }
  assert.equal(beginnerModeRestored, true, "deselecting a result should restore the beginner assistant");
} finally {
  socket.close();
}

console.log("PASS full homepage quick-create interaction");
