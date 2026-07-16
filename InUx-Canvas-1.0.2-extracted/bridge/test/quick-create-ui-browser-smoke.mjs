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
      tabs: [...document.querySelectorAll('.quick-create-type-tab')].map((element) => element.innerText),
      modes: [...document.querySelectorAll('.quick-create-mode')].map((element) => element.innerText),
      promptPlaceholder: document.querySelector('.quick-create-prompt')?.placeholder || ''
    })`),
  );
  assert.equal(initial.visible, true);
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
  assert.match(initial.promptPlaceholder, /描述你要生成的画面/);

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

  let generated = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(100);
    generated = await evaluate(`Boolean(document.querySelector('.result-image-node img'))`);
    if (generated) break;
  }
  assert.equal(generated, true, "quick create did not automatically run image generation");
  assert.match(await evaluate(`document.querySelector('.canvas-title-input')?.value || ''`), /科技蓝机械蜜蜂/);
} finally {
  socket.close();
}

console.log("PASS full homepage quick-create interaction");
