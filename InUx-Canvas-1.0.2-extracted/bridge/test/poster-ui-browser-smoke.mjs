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
  await wait(600);
  await evaluate(`document.querySelector('.new-project-card')?.click()`);
  await wait(500);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '图片')?.click()`,
  );
  await wait(500);
  await evaluate(`document.querySelector('.react-flow__node')?.click()`);
  await wait(500);

  const initial = await evaluate(`JSON.stringify({
    visible: Boolean(document.querySelector('.poster-template-panel')),
    brief: Boolean(document.querySelector('.poster-template-brief')),
    modeSwitch: Boolean(document.querySelector('.image-composer-mode-switch')),
    materialOpen: document.querySelector('.image-composer-poster-material')?.open || false,
    creationFields: Boolean(document.querySelector('.image-creation-fields')),
    advancedOpen: document.querySelector('.poster-template-advanced')?.open || false,
    fields: document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea').length,
    styles: [...document.querySelectorAll('.poster-template-style')].map((element) => element.textContent.trim())
  })`);
  const initialState = JSON.parse(initial);
  assert.equal(initialState.visible, true);
  assert.equal(initialState.brief, true);
  assert.equal(initialState.modeSwitch, false);
  assert.equal(initialState.materialOpen, false);
  assert.equal(initialState.creationFields, true);
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
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '立即生成')?.click()`,
  );
  await wait(100);
  const validation = await evaluate(
    `document.querySelector('.poster-template-message')?.innerText || ''`,
  );
  assert.match(validation, /请描述你想制作的海报/);

  await evaluate(`(() => {
    const field = document.querySelector('.poster-template-brief');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '为宏利示例制作一张保险年度业绩海报，主标题为2026年度增长报告，核心数据312.9亿元，同比增长39%，行动号召是查看完整报告。');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '立即生成')?.click()`,
  );
  await wait(500);

  const submittedLabel = await evaluate(
    `[...document.querySelectorAll('.poster-template-panel button')].find((button) => button.innerText.includes('提交生成'))?.innerText || ''`,
  );

  const applied = await evaluate(`JSON.stringify({
    nodeStatus: document.querySelector('.image-processor-node')?.className || ''
  })`);
  const appliedState = JSON.parse(applied);
  assert.equal(submittedLabel, "已提交生成");
  assert.match(appliedState.nodeStatus, /running|success/);
} finally {
  socket.close();
}

console.log("PASS structured commercial poster form browser interaction");
