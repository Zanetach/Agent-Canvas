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

async function waitFor(expression, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(100);
    if (await evaluate(expression)) return true;
  }
  return false;
}

try {
  await wait(600);
  await evaluate(`document.querySelector('.new-project-card')?.click()`);
  await wait(500);
  await evaluate(
    `document.querySelector('.canvas-toolbar-add-option[aria-label="图片"]')?.click()`,
  );
  await wait(500);
  await evaluate(`document.querySelector('.react-flow__node')?.click()`);
  await wait(500);

  const initial = await evaluate(`JSON.stringify({
    visible: Boolean(document.querySelector('.poster-template-panel')),
    brief: Boolean(document.querySelector('.poster-template-brief')),
    modeSwitch: Boolean(document.querySelector('.image-composer-mode-switch')),
    separateComposer: Boolean(document.querySelector('.canvas-composer-dock')),
    unifiedCreator: Boolean(document.querySelector('.canvas-image-assistant-form')),
    materialOpen: document.querySelector('.image-composer-poster-material')?.open || false,
    advancedOpen: document.querySelector('.poster-template-advanced')?.open || false,
    fields: document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea').length,
    styles: [...document.querySelectorAll('.poster-template-style')].map((element) => element.textContent.trim())
  })`);
  const initialState = JSON.parse(initial);
  assert.equal(initialState.visible, true);
  assert.equal(initialState.brief, false);
  assert.equal(initialState.modeSwitch, false);
  assert.equal(initialState.separateComposer, false);
  assert.equal(initialState.unifiedCreator, true);
  assert.equal(initialState.materialOpen, false);
  assert.equal(initialState.advancedOpen, false);
  assert.equal(initialState.fields, 10);
  assert.deepEqual(initialState.styles, [
    "翡翠绿企业数据风",
    "象牙白海军蓝法律风",
    "深蓝金色招生紧迫风",
  ]);

  await evaluate(`document.querySelector('.image-composer-poster-material').open = true`);
  await wait(100);

  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '应用海报模板')?.click()`,
  );
  await wait(100);
  const validation = await evaluate(
    `document.querySelector('.poster-template-message')?.innerText || ''`,
  );
  assert.match(validation, /请先在上方填写图片或海报描述/);

  await evaluate(`(() => {
    const fields = [...document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea')];
    for (const field of fields) {
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor.set.call(field, '示例海报信息');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await wait(100);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '应用海报模板')?.click()`,
  );
  await wait(100);
  assert.match(
    await evaluate(`document.querySelector('.poster-template-message')?.innerText || ''`),
    /请先在上方填写图片或海报描述/,
  );

  await evaluate(`(() => {
    const field = document.querySelector('.canvas-image-assistant-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '为宏利示例制作一张保险年度业绩海报，主标题为2026年度增长报告，核心数据312.9亿元，同比增长39%，行动号召是查看完整报告。');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '应用海报模板')?.click()`,
  );
  const templateApplied = await waitFor(
    `document.querySelector('.poster-template-apply')?.innerText === '模板已应用'`,
  );
  assert.equal(templateApplied, true);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.result-image-node img'))`),
    false,
  );
  const appliedPrompt = await evaluate(
    `document.querySelector('.canvas-image-assistant-prompt')?.value || ''`,
  );
  assert.ok(appliedPrompt.length > 100);
  assert.match(appliedPrompt, /2026年度增长报告/);
  assert.match(appliedPrompt, /翡翠绿和青绿色单色体系/);
  assert.equal(
    await evaluate(`document.querySelector('select[aria-label="图片比例"]')?.value`),
    '3:4',
  );

  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '开始生成')?.click()`,
  );
  const posterGenerated = await waitFor(
    `Boolean(document.querySelector('.result-image-node img'))`,
    80,
  );

  const applied = await evaluate(`JSON.stringify({
    separateComposer: Boolean(document.querySelector('.canvas-composer-dock')),
    unifiedCreator: !document.querySelector('.canvas-image-assistant')?.hidden
  })`);
  const appliedState = JSON.parse(applied);
  assert.equal(posterGenerated, true);
  assert.equal(appliedState.separateComposer, false);
  assert.equal(appliedState.unifiedCreator, true);
} finally {
  socket.close();
}

console.log("PASS structured commercial poster form browser interaction");
